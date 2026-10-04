// app/api/admin/disputes/route.js
import { NextResponse } from 'next/server'
import { getConnection } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { logActivity } from '@/lib/logger'
import { requireCaller } from '@/lib/api-auth';

// ── GET: All disputes ─────────────────────────────────────────────────────────
export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection
  try {
    connection = await getConnection()

    // 1. All disputes with booking + customer + provider details
    const [disputes] = await connection.execute(`
      SELECT 
        d.id,
        d.booking_id,
        d.reason,
        d.status,
        d.admin_notes,
        DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(d.resolved_at, '%Y-%m-%d %H:%i:%s') as resolved_at,
        b.booking_number,
        b.service_name,
        b.service_price,
        b.payment_status,
        b.payment_intent_id,
        b.authorized_amount,
        CONCAT(u.first_name, ' ', u.last_name) as customer_name,
        u.email as customer_email,
        sp.name as provider_name,
        sp.email as provider_email
      FROM disputes d
      LEFT JOIN bookings b    ON d.booking_id = b.id
      LEFT JOIN users u       ON d.raised_by_user_id = u.id
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      ORDER BY 
        CASE d.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        d.created_at DESC
    `)

    // 2. Summary stats
    const [summary] = await connection.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'reviewing' THEN 1 ELSE 0 END) as reviewing_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
      FROM disputes
    `)

    connection.release()

    return NextResponse.json({
      success: true,
      data: {
        summary: summary[0],
        disputes
      }
    })

  } catch (error) {
    console.error('Admin disputes GET error:', error)
    if (connection) connection.release()
    return NextResponse.json({ success: false, message: 'Failed to load disputes' }, { status: 500 })
  }
}

// ── PATCH: Update dispute status / admin notes ────────────────────────────────
export async function PATCH(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection
  try {
    const { dispute_id, status, admin_notes, booking_action } = await request.json()
    // booking_action: 'release' = approve payment to provider, 'refund' = refund customer

    if (!dispute_id || !status) {
      return NextResponse.json({ success: false, message: 'dispute_id and status required' }, { status: 400 })
    }

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    // Get dispute + booking info
    const [[dispute]] = await connection.execute(`
      SELECT d.*, b.payment_intent_id, b.service_price, b.additional_price,
             b.actual_duration_minutes, b.standard_duration_minutes,
             b.provider_id, b.commission_percent, b.provider_amount,
             b.booking_number, b.service_name,
             sp.stripe_account_id, sp.stripe_onboarding_complete, sp.name as provider_name,
             CONCAT(u.first_name, ' ', u.last_name) as customer_name,
             u.email as customer_email, sp.email as provider_email
      FROM disputes d
      LEFT JOIN bookings b ON d.booking_id = b.id
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      LEFT JOIN users u ON d.raised_by_user_id = u.id
      WHERE d.id = ?
    `, [dispute_id])

    if (!dispute) {
      await connection.query('ROLLBACK')
      return NextResponse.json({ success: false, message: 'Dispute not found' }, { status: 404 })
    }

    if (action === 'process') {
      const Stripe = (await import('stripe')).default
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' })
      
      let stripeCaptureId = null
      let stripeTransferId = null
      
      const capAmt = parseFloat(capture_amount || 0)
      const provAmt = parseFloat(provider_amount || 0)
      
      if (capAmt > 0) {
        try {
          const cap = await stripe.paymentIntents.capture(dispute.payment_intent_id, {
            amount_to_capture: Math.round(capAmt * 100)
          })
          stripeCaptureId = cap.id
        } catch (err) {
          await connection.query('ROLLBACK')
          return NextResponse.json({ success: false, message: 'Stripe capture failed: ' + err.message }, { status: 400 })
        }
      } else {
        try {
          await stripe.paymentIntents.cancel(dispute.payment_intent_id)
        } catch (err) {
          await connection.query('ROLLBACK')
          return NextResponse.json({ success: false, message: 'Stripe cancel failed: ' + err.message }, { status: 400 })
        }
      }
      
      if (provAmt > 0 && dispute.stripe_account_id) {
        try {
          const trans = await stripe.transfers.create({
            amount: Math.round(provAmt * 100),
            currency: process.env.STRIPE_CURRENCY || 'cad',
            destination: dispute.stripe_account_id,
            transfer_group: `booking_${dispute.booking_id}`
          })
          stripeTransferId = trans.id
        } catch (err) {
          console.error('Stripe transfer failed:', err)
        }
      }
      
      await connection.execute(`
        UPDATE disputes SET
          captured_amount = ?, provider_amount = ?, stripe_capture_id = ?, stripe_transfer_id = ?,
          status = 'resolved', admin_notes = COALESCE(?, admin_notes), resolved_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `, [capAmt, provAmt, stripeCaptureId, stripeTransferId, admin_notes || null, dispute_id])
      
      await connection.execute(
        `UPDATE bookings SET payment_status = ?, status = 'completed', updated_at = NOW() WHERE id = ?`,
        [capAmt > 0 ? 'paid' : 'canceled', dispute.booking_id]
      )
      
      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'completed', ?)`,
        [dispute.booking_id, `Dispute processed. Captured: $${capAmt}, Provider paid: $${provAmt}. Admin notes: ${admin_notes || ''}`]
      )
      
      // Log Activity
      logActivity({
        actor_id: 1, // Admin actor (assuming ID 1 for now, or extract from token if available in this route later)
        actor_type: 'admin',
        actor_name: 'Admin',
        action: 'DISPUTE_RESOLVED',
        entity_type: 'dispute',
        entity_id: dispute_id,
        details: { status: 'resolved', capture_amount: capAmt, provider_amount: provAmt }
      })

      await connection.query('COMMIT')
      connection.release()
      return NextResponse.json({ success: true, message: 'Dispute processed successfully' })
    }
    // Update dispute
    await connection.execute(
      `UPDATE disputes SET 
        status = ?,
        admin_notes = COALESCE(?, admin_notes),
        resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN NOW() ELSE resolved_at END,
        updated_at = NOW()
       WHERE id = ?`,
      [status, admin_notes || null, status, dispute_id]
    )

    // Update booking status history
    await connection.execute(
      `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'disputed', ?)`,
      [dispute.booking_id, `Admin updated dispute: ${status}. ${admin_notes || ''}`]
    )

    // Log Activity
    logActivity({
      actor_id: 1,
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'DISPUTE_UPDATED',
      entity_type: 'dispute',
      entity_id: dispute_id,
      details: { status }
    })

    await connection.query('COMMIT')
    connection.release()

    return NextResponse.json({
      success: true,
      message: `Dispute updated to: ${status}`
    })

  } catch (error) {
    console.error('Admin disputes PATCH error:', error)
    if (connection) {
      await connection.query('ROLLBACK').catch(() => {})
      connection.release()
    }
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}


















