// app/api/cron/auto-release/route.js
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { execute, getConnection } from '@/lib/db'
import { requireCronSecret } from '@/lib/api-auth'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', { apiVersion: '2026-05-27.dahlia' })

export async function GET(request) {
  const secret = requireCronSecret(request)
  if (!secret.ok) return secret.response

  // Find all bookings awaiting_approval for more than 24 hours with no customer response
  const expiredBookings = await execute(`
    SELECT b.*, sp.stripe_account_id 
    FROM bookings b
    LEFT JOIN service_providers sp ON b.provider_id = sp.id
    WHERE b.status = 'awaiting_approval'
      AND b.updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND b.payment_intent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM disputes d WHERE d.booking_id = b.id AND d.status IN ('open', 'reviewing')
      )
  `)

  console.log(`Auto-release: Found ${expiredBookings.length} expired bookings`)

  const results = []

  for (const booking of expiredBookings) {
    const connection = await getConnection()
    try {
      await connection.query('START TRANSACTION')

      // Capture payment
      try {
        await stripe.paymentIntents.capture(booking.payment_intent_id)
      } catch (err) {
        if (!err.message.includes('already been captured')) throw err
      }

      // Transfer to provider
      const providerAmount = parseFloat(booking.final_provider_amount || booking.provider_amount || 0)
      const providerAmountCents = Math.round(providerAmount * 100)

      if (providerAmountCents > 0 && booking.stripe_account_id) {
        await stripe.transfers.create({
          amount: providerAmountCents,
          currency: process.env.STRIPE_CURRENCY || 'cad',
          destination: booking.stripe_account_id,
          transfer_group: `booking_${booking.id}`,
          metadata: {
            booking_id: booking.id.toString(),
            booking_number: booking.booking_number,
            auto_release: 'true'
          }
        })
      }

      await connection.execute(
        `UPDATE bookings SET status = 'completed', payment_status = 'paid', updated_at = NOW() WHERE id = ?`,
        [booking.id]
      )
      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'completed', 'Auto-released after 24 hours - no customer response')`,
        [booking.id]
      )

      await connection.query('COMMIT')
      results.push({ booking_id: booking.id, status: 'released' })
      console.log(`✅ Auto-released booking ${booking.id}`)

    } catch (err) {
      await connection.query('ROLLBACK')
      results.push({ booking_id: booking.id, status: 'failed', error: err.message })
      console.error(`❌ Failed booking ${booking.id}:`, err.message)
    } finally {
      connection.release()
    }
  }

  return NextResponse.json({ success: true, processed: expiredBookings.length, results })
}