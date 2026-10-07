import { NextResponse } from 'next/server'
import { execute, getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth';
import { providerPayout } from '@/lib/booking-price'

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id: booking_id } = await params
    const { worker_count, actual_duration_minutes, reason } = await request.json()

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ success: false, message: 'A reason must be provided for the audit log' }, { status: 400 })
    }

    const connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      // Get current booking details + service pricing for invoice recalculation
      const [[booking]] = await connection.execute(
        `SELECT b.worker_count, b.actual_duration_minutes, b.submitted_duration_minutes,
                b.submitted_headcount, b.commission_percent,
                b.service_price, b.additional_price,
                s.duration_minutes as service_duration
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         WHERE b.id = ?`,
        [booking_id]
      )

      if (!booking) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 })
      }

      // Update the booking
      await connection.execute(
        `UPDATE bookings SET 
          worker_count = ?, 
          actual_duration_minutes = ?,
          submitted_headcount = ?,
          submitted_duration_minutes = ?
         WHERE id = ?`,
        [worker_count, actual_duration_minutes, worker_count, actual_duration_minutes, booking_id]
      )

      // Insert audit log
      await connection.execute(
        `INSERT INTO booking_audit_logs 
        (booking_id, admin_id, old_worker_count, new_worker_count, old_actual_duration, new_actual_duration, reason) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          booking_id,
          auth.caller.id,
          booking.worker_count || 1,
          worker_count,
          booking.actual_duration_minutes || 0,
          actual_duration_minutes,
          reason
        ]
      )

      // ── Recalculate invoice amounts based on new values ──────────────────
      // The invoice total is the booking's recorded price; time past the standard duration is shown, not billed.
      const standardDuration  = parseInt(booking.service_duration || 60)
      const baseRate          = parseFloat(booking.service_price || 0)
      const newActualDuration = parseInt(actual_duration_minutes || 0)

      let overtimeMinutes = 0
      const overtimeAmount = 0
      if (newActualDuration > standardDuration) {
        overtimeMinutes = newActualDuration - standardDuration
      }

      const totalAmount       = baseRate
      const providerEarnings  = providerPayout(booking)
      const commissionAmount  = Math.round((totalAmount - providerEarnings) * 100) / 100
      const overtimeEarnings  = 0

      // Update invoices if they already exist for this booking
      const [existingInvoices] = await connection.execute(
        `SELECT id FROM invoices WHERE booking_id = ?`,
        [booking_id]
      )

      if (existingInvoices.length > 0) {
        await connection.execute(
          `UPDATE invoices SET
            actual_duration   = ?,
            overtime_minutes  = ?,
            overtime_amount   = ?,
            total_amount      = ?,
            commission_amount = ?,
            provider_earnings = ?,
            final_provider_amount = ?,
            overtime_earnings = ?
           WHERE booking_id = ?`,
          [
            newActualDuration,
            overtimeMinutes,
            overtimeAmount,
            totalAmount,
            commissionAmount,
            providerEarnings,
            providerEarnings,
            overtimeEarnings,
            booking_id
          ]
        )
      }
      // ─────────────────────────────────────────────────────────────────────

      await connection.query('COMMIT')
      
      return NextResponse.json({ success: true, message: 'Job details updated successfully' })
    } catch (dbError) {
      await connection.query('ROLLBACK')
      throw dbError
    } finally {
      connection.release()
    }
  } catch (error) {
    console.error('Error updating job override:', error)
    return NextResponse.json({ success: false, message: 'Failed to update job details' }, { status: 500 })
  }
}
