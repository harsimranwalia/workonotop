// app/api/cron/auto-release/route.js
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { execute, getConnection } from '@/lib/db'
import { requireCronSecret } from '@/lib/api-auth'
import { providerPayout } from '@/lib/booking-price'
import { collectBookingPayment, businessToday } from '@/lib/booking-payment'
import { cardOnFile } from '@/lib/booking-card'
import { notifyUser } from '@/lib/push'
import { sendEmail } from '@/lib/email'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null

export async function GET(request) {
  const secret = requireCronSecret(request)
  if (!secret.ok) return secret.response

  // Find all bookings awaiting_approval for more than 24 hours with no customer response. A booking whose payment could
  // not be taken is left to the admins and is not picked up again.
  // A later visit of a series holds no payment of its own; it is charged on its series' card when it is done, and not before
  // its date: done is a provider's click or an admin's write, which can come weeks early. today is the day it is now in the
  // business's time zone, read once for the run: the query leaves out a visit whose date is ahead (it is picked up on the first
  // run on or after its date), and the payment module refuses one that got through. A booking with a payment of its own is not
  // held to a date here (a one-time booking's date is whatever the customer typed); a later visit's date is the series' own.
  // A booking an admin made on a customer's behalf (it has a row in booking_card_links) holds no payment either and is no visit of a
  // series: it is charged on the card its customer put on file from the link, held to its date as a later visit is, because the click
  // that marks it done can come weeks early. It is picked up even when no card was ever added: collectBookingPayment then answers
  // no_payment_method, and the booking ends payment_status 'failed' with the admins emailed, instead of waiting for ever in
  // awaiting_approval where nobody would see it. That is the third arm of the group below, which only a booking with a link row matches.
  const today = businessToday(Date.now())
  const expiredBookings = await execute(`
    SELECT b.*, sp.stripe_account_id 
    FROM bookings b
    LEFT JOIN service_providers sp ON b.provider_id = sp.id
    WHERE b.status = 'awaiting_approval'
      AND b.updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND (
        b.payment_intent_id IS NOT NULL OR (b.series_visit > 1 AND b.job_date <= ?)
        OR (b.series_id IS NULL AND b.job_date <= ? AND EXISTS (SELECT 1 FROM booking_card_links l WHERE l.booking_id = b.id))
      )
      AND (b.payment_status IS NULL OR b.payment_status <> 'failed')
      AND NOT EXISTS (
        SELECT 1 FROM disputes d WHERE d.booking_id = b.id AND d.status IN ('open', 'reviewing')
      )
  `, [today, today])

  console.log(`Auto-release: Found ${expiredBookings.length} expired bookings`)

  const results = []

  for (const booking of expiredBookings) {
    let connection
    try {
      // A later visit of a series holds no payment of its own: it is charged on the card of the payment its series' first
      // visit holds, read from that visit only when it is the same customer's booking.
      let cardIntentId = null
      if (!booking.payment_intent_id && booking.series_visit > 1) {
        const [first] = await execute(
          'SELECT payment_intent_id FROM bookings WHERE id = ? AND user_id = ?',
          [booking.series_id, booking.user_id]
        )
        cardIntentId = first ? first.payment_intent_id : null
      }

      // A booking an admin made on a customer's behalf is charged on the card its customer put on file from a link. That is asked
      // only when nothing else names a card, so any other booking costs no query; with no card, collectBookingPayment answers
      // no_payment_method and the booking is failed below like any other whose payment cannot be taken.
      let card = null
      if (!booking.payment_intent_id && !cardIntentId) card = await cardOnFile(execute, booking)

      // The release takes the one charge for the booking's recorded price and pays the provider by the payout rule. The payment
      // is taken ahead of the booking's connection: the two callbacks take their own from the pool, so a connection held by this
      // run never waits for another.
      const collected = await collectBookingPayment(stripe, booking, {
        currency: process.env.STRIPE_CURRENCY || 'cad',
        cardIntentId,
        card,
        today,
        // These two run on the pool and this run holds no connection while they do: a charge saved on the booking stays saved
        // whatever this run does next. The save compares with <=>, which also matches the empty payment of a later visit or of
        // a booking made on a customer's behalf.
        saveIntentId: async (newId, oldId) => {
          const result = await execute(
            'UPDATE bookings SET payment_intent_id = ? WHERE id = ? AND payment_intent_id <=> ?',
            [newId, booking.id, oldId]
          )
          return result.affectedRows > 0
        },
        readIntentId: async () => {
          const [row] = await execute('SELECT payment_intent_id FROM bookings WHERE id = ?', [booking.id])
          return row ? row.payment_intent_id : null
        },
      })

      // A visit whose date is still ahead is neither charged nor failed: it stays as it is, nobody is told, and the first run on
      // or after its date takes it.
      if (!collected.ok && collected.reason === 'not_due') {
        results.push({ booking_id: booking.id, status: 'not_due' })
        console.log(`⏳ Booking ${booking.id}: its date (${collected.day}) has not come, not charged`)
        continue
      }

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
