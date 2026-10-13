// app/api/cron/auto-release/route.js
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { execute, getConnection } from '@/lib/db'
import { requireCronSecret } from '@/lib/api-auth'
import { providerPayout } from '@/lib/booking-price'
import { collectBookingPayment } from '@/lib/booking-payment'
import { notifyUser } from '@/lib/push'
import { sendEmail } from '@/lib/email'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null

export async function GET(request) {
  const secret = requireCronSecret(request)
  if (!secret.ok) return secret.response

  // Find all bookings awaiting_approval for more than 24 hours with no customer response. A booking whose payment could
  // not be taken is left to the admins and is not picked up again.
  const expiredBookings = await execute(`
    SELECT b.*, sp.stripe_account_id 
    FROM bookings b
    LEFT JOIN service_providers sp ON b.provider_id = sp.id
    WHERE b.status = 'awaiting_approval'
      AND b.updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND b.payment_intent_id IS NOT NULL
      AND (b.payment_status IS NULL OR b.payment_status <> 'failed')
      AND NOT EXISTS (
        SELECT 1 FROM disputes d WHERE d.booking_id = b.id AND d.status IN ('open', 'reviewing')
      )
  `)

  console.log(`Auto-release: Found ${expiredBookings.length} expired bookings`)

  const results = []

  for (const booking of expiredBookings) {
    let connection
    try {
      // The release takes the one charge for the booking's recorded price and pays the provider by the payout rule. The payment
      // is taken before this booking's connection is: the two callbacks take their own from the pool, and a run that held one
      // while it waited for another could, with enough requests at once, leave every connection held.
      const collected = await collectBookingPayment(stripe, booking, {
        currency: process.env.STRIPE_CURRENCY || 'cad',
        // These two run on the pool and this run holds no connection while they do: a charge saved on the booking stays saved
        // whatever this run does next.
        saveIntentId: async (newId, oldId) => {
          const result = await execute(
            'UPDATE bookings SET payment_intent_id = ? WHERE id = ? AND payment_intent_id = ?',
            [newId, booking.id, oldId]
          )
          return result.affectedRows > 0
        },
        readIntentId: async () => {
          const [row] = await execute('SELECT payment_intent_id FROM bookings WHERE id = ?', [booking.id])
          return row ? row.payment_intent_id : null
        },
      })

      if (!collected.ok && (collected.reason === 'unavailable' || collected.reason === 'not_configured')) {
        results.push({ booking_id: booking.id, status: 'retry' })
        console.error(`⏳ Booking ${booking.id}: payments unavailable, the next run tries again`)
        continue
      }

      connection = await getConnection()
      await connection.query('START TRANSACTION')

      if (!collected.ok) {
        await connection.execute(
          `UPDATE bookings SET payment_status = 'failed', updated_at = NOW() WHERE id = ?`,
          [booking.id]
        )
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'payment_failed', ?)`,
          [booking.id, `Payment could not be taken: ${collected.reason}`]
        )
        await connection.query('COMMIT')

        const adminEmail = process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL
        if (adminEmail) {
          sendEmail({
            to: adminEmail,
            subject: `⚠️ Payment could not be taken — Booking #${booking.booking_number}`,
            html: `<p>The payment for booking <strong>#${booking.booking_number}</strong> could not be taken (${collected.reason}). No payout was made. Please contact the customer.</p>`,
            text: `The payment for booking #${booking.booking_number} could not be taken (${collected.reason}). No payout was made.`
          }).catch(e => console.error('Admin payment-failed email error:', e))
        } else {
          console.warn('ADMIN_EMAIL not set: the payment-failed email was not sent')
        }
        execute("SELECT id FROM users WHERE role = 'admin'").then(admins => {
          admins.forEach(admin => {
            notifyUser(admin.id, 'Payment could not be taken', `Booking #${booking.booking_number}: the payment could not be taken. No payout was made.`, { bookingId: booking.id, type: 'payment_failed' }, execute, 'admin')
              .catch(e => console.error('Admin payment-failed push error:', e))
          })
        }).catch(e => console.error('Admin payment-failed lookup error:', e))

        results.push({ booking_id: booking.id, status: 'payment_failed' })
        console.error(`❌ Booking ${booking.id}: payment could not be taken (${collected.reason})`)
        continue
      }

      if (collected.overCollected) {
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'payment_review', ?)`,
          [booking.id, `The payment collected $${(collected.amountCents / 100).toFixed(2)} against a recorded price of $${parseFloat(booking.service_price || 0).toFixed(2)}; the difference is for the admin to review.`]
        )
      }

      // Transfer to provider
      const providerAmount = providerPayout(booking)
      const providerAmountCents = Math.round(providerAmount * 100)

      if (providerAmountCents > 0 && booking.stripe_account_id) {
        // The provider is paid from this booking's charge (source_transaction), so every payout of that charge
        // stays within it; the key makes the next run's repeat of this call for the same booking and charge return the first
        // transfer.
        await stripe.transfers.create({
          amount: providerAmountCents,
          currency: process.env.STRIPE_CURRENCY || 'cad',
          destination: booking.stripe_account_id,
          source_transaction: collected.chargeId,
          transfer_group: `booking_${booking.id}`,
          metadata: {
            booking_id: booking.id.toString(),
            booking_number: booking.booking_number,
            auto_release: 'true'
          }
        }, { idempotencyKey: `booking-${booking.id}-transfer-${collected.chargeId}` })
      }

      await connection.execute(
        `UPDATE bookings SET status = 'completed', payment_status = 'paid', final_provider_amount = ?, updated_at = NOW() WHERE id = ?`,
        [providerAmount, booking.id]
      )
      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'completed', 'Auto-released after 24 hours - no customer response')`,
        [booking.id]
      )

      await connection.query('COMMIT')
      results.push({ booking_id: booking.id, status: 'released' })
      console.log(`✅ Auto-released booking ${booking.id}`)

    } catch (err) {
      if (connection) await connection.query('ROLLBACK')
      results.push({ booking_id: booking.id, status: 'failed', error: err.message })
      console.error(`❌ Failed booking ${booking.id}:`, err.message)
    } finally {
      if (connection) connection.release()
    }
  }

  return NextResponse.json({ success: true, processed: expiredBookings.length, results })
}
