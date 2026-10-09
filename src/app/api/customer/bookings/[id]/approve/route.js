// app/api/customer/bookings/[id]/approve/route.js
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { withConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'
import { notifyUser } from '@/lib/push'
import { logActivity } from '@/lib/logger'
import { providerPayout } from '@/lib/booking-price'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', { apiVersion: '2026-05-27.dahlia' })

// ── Receipt email ─────────────────────────────────────────────────────────────
function receiptHtml({ bookingNumber, serviceName, customerName, providerName, amount, isCustomer, jobDate }) {
  const label = isCustomer ? 'Total Paid' : 'Your Earnings'
  const color = isCustomer ? '#16a34a' : '#2563eb'
  const banner = isCustomer ? 'linear-gradient(135deg,#0f766e,#0891b2)' : 'linear-gradient(135deg,#7e22ce,#9333ea)'
  const icon = isCustomer ? '🧾' : '💰'
  const title = isCustomer ? 'Payment Receipt' : 'Payment Received'
  const intro = isCustomer
    ? `Thank you for your payment. Your booking with <strong>${providerName}</strong> has been completed.`
    : `Payment processed for <strong>${serviceName}</strong> provided to ${customerName}.`

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding-bottom:20px;">
        <span style="font-size:22px;font-weight:700;color:#0f766e;">Work<span style="color:#0891b2;">On</span>Tap</span>
      </td></tr>
      <tr><td style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:${banner};padding:40px 32px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">${icon}</div>
            <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">${title}</h1>
          </td></tr>
          <tr><td style="padding:40px;">
            <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${isCustomer ? customerName : providerName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">${intro}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 8px;font-size:14px;color:#334155;"><strong>Booking #:</strong> ${bookingNumber}</p>
                <p style="margin:0 0 8px;font-size:14px;color:#334155;"><strong>Service:</strong> ${serviceName}</p>
                <p style="margin:0;font-size:14px;color:#334155;"><strong>Date:</strong> ${jobDate ? new Date(jobDate).toLocaleDateString() : new Date().toLocaleDateString()}</p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;margin-bottom:24px;">
              <tr><td style="padding:20px;text-align:center;">
                <p style="margin:0 0 5px;font-size:14px;color:#64748b;">${label}</p>
            <p style="margin:0;font-size:36px;font-weight:bold;color:${color};">$${parseFloat(amount).toFixed(2)}</p>
          </td></tr>
        </table>
        <p style="margin:0;font-size:14px;color:#64748b;">Thank you for using WorkOnTap!<br>The WorkOnTap Team</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 0;text-align:center;">
    <p style="margin:0;font-size:13px;color:#94a3b8;">© ${new Date().getFullYear()} WorkOnTap · Canada</p>
  </td></tr>
</table></body></html>`
}

// ── Dispute email for ADMIN ───────────────────────────────────────────────────
function disputeAdminHtml({ bookingNumber, serviceName, customerName, providerName, reason, bookingId }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <tr><td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:32px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
        <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">New Dispute Raised</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 20px;font-size:15px;color:#475569;">A customer has raised a dispute. <strong>Funds are held in escrow</strong> and will not be released until you resolve this.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;margin-bottom:20px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 8px;font-size:14px;color:#991b1b;"><strong>Booking #:</strong> ${bookingNumber}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#991b1b;"><strong>Service:</strong> ${serviceName}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#991b1b;"><strong>Customer:</strong> ${customerName}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#991b1b;"><strong>Provider:</strong> ${providerName}</p>
            <p style="margin:0;font-size:14px;color:#991b1b;"><strong>Booking ID:</strong> #${bookingId}</p>
          </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;margin-bottom:20px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#92400e;">Dispute Reason:</p>
            <p style="margin:0;font-size:14px;color:#78350f; word-break: break-word; break-all;">${reason}</p>
          </td></tr>
        </table>
        <p style="margin:0;font-size:14px;color:#64748b;">Please review this dispute in the admin dashboard and take appropriate action within 24 hours.</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}

// ── Dispute email for PROVIDER ────────────────────────────────────────────────
function disputeProviderHtml({ bookingNumber, serviceName, customerName, providerName, reason }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <tr><td style="background:linear-gradient(135deg,#ea580c,#dc2626);padding:32px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">🚨</div>
        <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Dispute Opened on Your Job</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 6px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${providerName},</p>
        <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
          A dispute has been raised by <strong>${customerName}</strong> for your completed job.
          <strong>Your payment is temporarily held</strong> while our team reviews the issue.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;margin-bottom:20px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 8px;font-size:14px;color:#991b1b;"><strong>Booking #:</strong> ${bookingNumber}</p>
            <p style="margin:0 0 8px;font-size:14px;color:#991b1b;"><strong>Service:</strong> ${serviceName}</p>
            <p style="margin:0;font-size:14px;color:#991b1b;"><strong>Customer:</strong> ${customerName}</p>
          </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:8px;margin-bottom:24px;">
          <tr><td style="padding:18px 20px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px;">Customer's Reason</p>
            <p style="margin:0;font-size:14px;color:#7c2d12;line-height:1.7;word-break: break-word; break-all;">${reason}</p>
          </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;margin-bottom:24px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#0369a1;">What happens next?</p>
            <p style="margin:0 0 6px;font-size:13px;color:#0c4a6e;">• Our team will review the dispute within 24 hours</p>
            <p style="margin:0 0 6px;font-size:13px;color:#0c4a6e;">• Funds remain held until resolution</p>
            <p style="margin:0;font-size:13px;color:#0c4a6e;">• You may be contacted for more information</p>
          </td></tr>
        </table>
        <p style="margin:0;font-size:14px;color:#64748b;">
          Questions? Contact us at <a href="mailto:support@workontap.com" style="color:#0891b2;text-decoration:none;">support@workontap.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller

  const { id } = await params
  const { action, dispute_reason, source } = await request.json()
  
  console.log(`[Approve API] received action: ${action}, source: ${source}`);

  if (!['approve', 'dispute'].includes(action)) {
    return NextResponse.json({ success: false, message: 'action must be approve or dispute' }, { status: 400 })
  }

  try {
    return await withConnection(async (connection) => {
      await connection.query('START TRANSACTION')

      try {
        // ── Fetch booking ──────────────────────────────────────────────────
        const [[booking]] = await connection.execute(`
          SELECT 
            b.*,
            sp.stripe_account_id,
            sp.name            AS provider_name,
            sp.email           AS provider_email,
            sp.stripe_onboarding_complete,
            u.phone AS customer_phone,
            COALESCE(s.duration_minutes, b.standard_duration_minutes, 60) AS standard_mins
          FROM bookings b
          LEFT JOIN service_providers sp ON b.provider_id = sp.id
          LEFT JOIN services          s  ON b.service_id  = s.id
          LEFT JOIN users             u  ON b.user_id     = u.id
          WHERE b.id = ? AND b.user_id = ?
        `, [id, caller.id])

        if (!booking) {
          await connection.query('ROLLBACK')
          // A booking that exists but is not the caller's own is a 403, never the 404 below; one that does not exist keeps the 404.
          const [[existing]] = await connection.execute('SELECT id FROM bookings WHERE id = ?', [id])
          if (existing) {
            return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
          }
          return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 })
        }

        if (booking.status !== 'awaiting_approval') {
          await connection.query('ROLLBACK')
          return NextResponse.json({
            success: false,
            message: `Booking status is '${booking.status}', expected 'awaiting_approval'`
          }, { status: 400 })
        }

        // ── Get customer info ──────────────────────────────────────────────
        const [[customer]] = await connection.execute(
          `SELECT email, first_name, last_name FROM users WHERE id = ?`,
          [booking.user_id]
        )
        const customerName = customer ? `${customer.first_name} ${customer.last_name}`.trim() : 'Customer'
        const customerEmail = customer?.email

        // ════════════════════════════════════════════════════════════════════
        // DISPUTE ACTION
        // ════════════════════════════════════════════════════════════════════
        if (action === 'dispute') {
          if (!dispute_reason?.trim()) {
            await connection.query('ROLLBACK')
            return NextResponse.json({ success: false, message: 'Dispute reason is required' }, { status: 400 })
          }

          // 1. Update booking status → disputed (funds stay held in Stripe)
          await connection.execute(
            `UPDATE bookings SET status = 'disputed', updated_at = NOW() WHERE id = ?`,
            [id]
          )

          // 2. Log in booking_status_history
          await connection.execute(
            `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'disputed', ?)`,
            [id, `Customer disputed: ${dispute_reason}`]
          )

          // 3. Create automated ticket in disputes table for admin dashboard
          await connection.execute(
            `INSERT INTO disputes 
             (booking_id, raised_by_user_id, reason, status, created_at)
             VALUES (?, ?, ?, 'open', NOW())`,
            [id, caller.id, dispute_reason]
          )

          await connection.query('COMMIT')

          const emailPayload = {
            bookingNumber: booking.booking_number,
            serviceName: booking.service_name,
            customerName,
            providerName: booking.provider_name || 'Provider',
            reason: dispute_reason,
            bookingId: id
          }

          // 4. Send admin alert email
          const adminEmail = process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL
          console.log('Admin email value:', adminEmail)
          if (adminEmail) {
            try {
              await sendEmail({
                to: adminEmail,
                subject: `⚠️ Dispute Raised — Booking #${booking.booking_number}`,
                html: disputeAdminHtml(emailPayload),
                text: `Dispute raised for booking #${booking.booking_number}. Reason: ${dispute_reason}`
              })
              console.log('✅ Admin dispute email sent to:', adminEmail)
            } catch (e) {
              console.error('❌ Admin email FAILED:', e.message)
            }
          } else {
            console.warn('⚠️ ADMIN_EMAIL not set in .env')
          }

          // 5. Send provider alert email
          if (booking.provider_email) {
            try {
              await sendEmail({
                to: booking.provider_email,
                subject: `🚨 Dispute Opened — Booking #${booking.booking_number}`,
                html: disputeProviderHtml(emailPayload),
                text: `A dispute has been raised on booking #${booking.booking_number}. Reason: ${dispute_reason}. Your payment is held until resolved.`
              })
              console.log('✅ Provider dispute email sent to:', booking.provider_email)
            } catch (e) {
              console.error('❌ Provider email FAILED:', e.message)
            }
          }

          return NextResponse.json({
            success: true,
            message: '⚠️ Dispute raised. Our team will review within 24 hours. Funds are held securely.'
          })
        }

        // ════════════════════════════════════════════════════════════════════
        // APPROVE ACTION
        // ════════════════════════════════════════════════════════════════════
        if (action === 'approve') {
          if (!booking.payment_intent_id) {
            await connection.query('ROLLBACK')
            return NextResponse.json({ success: false, message: 'No payment intent found' }, { status: 400 })
          }

          // The customer is charged the booking's recorded price and the provider is paid by the payout rule (src/lib/booking-price.js).
          const finalAmount = parseFloat(booking.service_price || 0)
          const providerAmount = providerPayout(booking)
          const platformAmount = parseFloat((finalAmount - providerAmount).toFixed(2))

          // ── Stripe capture ───────────────────────────────────────────────
          try {
            const pi = await stripe.paymentIntents.retrieve(booking.payment_intent_id)
            const basePriceCents = Math.round(finalAmount * 100)
            const latestCharge = pi.latest_charge

            if (!latestCharge) {
              await connection.query('ROLLBACK')
              return NextResponse.json({ success: false, message: 'No charge available to capture.' }, { status: 400 })
            }

            if (pi.status === 'requires_capture') {
              await stripe.paymentIntents.capture(booking.payment_intent_id, { amount_to_capture: basePriceCents })
              console.log(`✅ Captured $${finalAmount} for booking #${id}`)
            } else if (pi.status !== 'succeeded') {
              await connection.query('ROLLBACK')
              return NextResponse.json({ success: false, message: `Cannot capture — status: ${pi.status}` }, { status: 400 })
            }
          } catch (stripeErr) {
            if (stripeErr.message?.includes('already been captured')) {
              console.log('Payment already captured, continuing...')
            } else {
              await connection.query('ROLLBACK')
              return NextResponse.json({
                success: false,
                message: 'Payment capture failed: ' + stripeErr.message
              }, { status: 400 })
            }
          }

          // ── Update booking ────────────────────────────────────────────────────────────────
          await connection.execute(
            `UPDATE bookings 
             SET status = 'completed',
                 payment_status = 'paid',
                 final_provider_amount = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [providerAmount, id]
          )

          // ── Update invoice status ─────────────────────────────────────────
          await connection.execute(
            `UPDATE invoices SET status = 'paid' WHERE booking_id = ?`,
            [id]
          )

          await connection.execute(
            `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'completed', ?)`,
            [id, `✅ Customer approved. Charged: $${finalAmount.toFixed(2)} | Platform: $${platformAmount.toFixed(2)} | Provider: $${providerAmount.toFixed(2)}`]
          )

          // ── Transfer to provider ─────────────────────────────────────────
          let transferId = null
          const hasStripe = booking.stripe_account_id && booking.stripe_onboarding_complete === 1
          const providerCents = Math.round(providerAmount * 100)

          if (hasStripe && providerCents > 0) {
            try {
              // Note: For split payments over multiple charges, we can skip source_transaction 
              // or handle it differently. But for now, we just transfer the amount.
              const transfer = await stripe.transfers.create({
                amount: providerCents,
                currency: process.env.STRIPE_CURRENCY || 'cad',
                destination: booking.stripe_account_id,
                metadata: {
                  booking_id: String(id),
                  booking_number: booking.booking_number,
                  provider_id: String(booking.provider_id)
                },
                description: `Payment for booking #${booking.booking_number}`
              })
              transferId = transfer.id
              console.log(`✅ Transfer ${transfer.id} → ${booking.provider_name}`)
            } catch (transferErr) {
              console.error('Transfer failed (non-fatal):', transferErr.message)
              await connection.execute(
                `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'payment_pending', ?)`,
                [id, `⚠️ Manual payout needed: $${providerAmount.toFixed(2)} → ${booking.provider_name}`]
              )
            }
          } else {
            await connection.execute(
              `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'payment_pending', ?)`,
              [id, `💰 Pay ${booking.provider_name} $${providerAmount.toFixed(2)} manually`]
            )
          }

          // ── Record payout ────────────────────────────────────────────────
          if (booking.provider_id && providerAmount > 0) {
            try {
              await connection.execute(
                `INSERT INTO provider_payouts 
                 (provider_id, amount, status, stripe_transfer_id, booking_id, notes, created_at)
                 VALUES (?, ?, 'pending', ?, ?, ?, NOW())`,
                [booking.provider_id, providerAmount, transferId, id,
                `Payment for booking #${booking.booking_number}`]
              )
              await connection.execute(
                `UPDATE service_providers 
                 SET total_earnings    = total_earnings    + ?,
                     available_balance = available_balance + ?,
                     lifetime_balance  = lifetime_balance  + ?
                 WHERE id = ?`,
                [providerAmount, providerAmount, providerAmount, booking.provider_id]
              )
            } catch (payoutErr) {
              console.error('Payout record error (non-fatal):', payoutErr.message)
            }
          }

          await connection.query('COMMIT')

          // Log Activity
          logActivity({
            actor_id: caller.id,
            actor_type: 'customer',
            actor_name: customerName,
            action: 'BOOKING_APPROVED',
            entity_type: 'booking',
            entity_id: id,
            details: { final_amount: finalAmount, provider_amount: providerAmount }
          })

          // ── Send receipt emails ──────────────────────────────────────────
          const emailData = {
            bookingNumber: booking.booking_number,
            serviceName: booking.service_name,
            customerName,
            providerName: booking.provider_name || 'Provider',
            jobDate: booking.job_date
          }

          if (customerEmail) {
            sendEmail({
              to: customerEmail,
              subject: `🧾 Your WorkOnTap Receipt — Booking #${booking.booking_number}`,
              html: receiptHtml({ ...emailData, amount: finalAmount, isCustomer: true }),
              text: `Payment of $${finalAmount.toFixed(2)} received. Booking #${booking.booking_number}`
            }).catch(e => console.error('Customer email error:', e))
          }

          if (booking.provider_email) {
            sendEmail({
              to: booking.provider_email,
              subject: `💰 Payment Received — Booking #${booking.booking_number}`,
              html: receiptHtml({ ...emailData, amount: providerAmount, isCustomer: false }),
              text: `Payment of $${providerAmount.toFixed(2)} processed. Booking #${booking.booking_number}`
            }).catch(e => console.error('Provider email error:', e))
          }

          return NextResponse.json({
            success: true,
            message: `✅ Payment released! You were charged $${finalAmount.toFixed(2)}. Receipt sent to your email.`,
            data: {
              total_charged: finalAmount,
              provider_received: providerAmount,
              admin_commission: platformAmount,
            }
          })
        }

      } catch (err) {
        await connection.query('ROLLBACK')
        throw err
      }
    })
  } catch (error) {
    console.error('Approve route error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}