// app/api/provider/jobs/time-tracking/route.js
import { NextResponse } from 'next/server'
import { execute, getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'
import { notifyUser } from '@/lib/push'
import { logActivity } from '@/lib/logger'
import { sendSMS } from '@/lib/sms'
import { providerPayout } from '@/lib/booking-price'
import { jobCompletedEmailHtml } from '@/lib/job-completed-email'

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  let connection
  try {
    const { booking_id, action, notes, work_summary, recommendations, worker_count, estimated_hours, submitted_duration_minutes, submitted_headcount, adjustment_reason } = await request.json()
    if (!booking_id || !action) return NextResponse.json({ success: false, message: 'booking_id and action required' }, { status: 400 })

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      // Ownership, before any write: the booking must be the caller's own (b.provider_id = caller.id). The query filters
      // by owner, so a booking that is another provider's and one that does not exist both answer the route's existing
      // 404 below.
      const [[booking]] = await connection.execute(
        `SELECT b.*, s.duration_minutes as standard_duration, s.name as service_name,
                  u.email as customer_email, u.first_name as customer_first_name, u.phone as customer_phone,
                  TIMESTAMPDIFF(MINUTE, b.start_time, NOW()) as current_duration
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         LEFT JOIN users u ON b.user_id = u.id
         WHERE b.id = ? AND b.provider_id = ?
         FOR UPDATE`,
        [booking_id, caller.id]
      )

      if (!booking) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: 'Booking not found or not assigned to you' }, { status: 404 })
      }

      const now = new Date()
      const standardDuration = booking.standard_duration || 60
      const overtimeRate = parseFloat(booking.additional_price || 0)

      switch (action) {
        case 'start':
          if (booking.status !== 'confirmed') {
            await connection.query('ROLLBACK')
            return NextResponse.json({ success: false, message: 'Job must be confirmed to start' }, { status: 400 })
          }
          await connection.execute(
            `UPDATE bookings SET status = 'in_progress', start_time = ?, job_timer_status = 'running', worker_count = ?, estimated_hours = ?, updated_at = NOW() WHERE id = ?`,
            [now, worker_count || 1, estimated_hours || null, booking_id]
          )
          // Create the first job session
          await connection.execute(
            `INSERT INTO job_sessions (booking_id, provider_id, clock_in) VALUES (?, ?, ?)`,
            [booking_id, caller.id, now]
          )
          await connection.execute(
            `INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'start', ?, ?)`,
            [booking_id, now, notes || 'Job started (First Session)']
          )
          await connection.execute(
            `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'in_progress', 'Provider started the job')`,
            [booking_id]
          )
          
          // Send SMS to customer
          const customerPhone = booking.customer_phone;
          if (customerPhone) {
            const price = parseFloat(booking.service_price || 0);
            const wCount = parseInt(worker_count || 1, 10);
            const eHours = parseFloat(estimated_hours || 1);
            
            const sName = booking.service_name || 'Service';
              const msg = `*WorkOnTap*
Service: ${sName}

Your professional has started the job!
- Professionals: ${wCount}
- Est. Time: ${eHours} hrs

Price: $${price.toFixed(2)}`;
            
            // Fire and forget
            sendSMS(customerPhone, msg).catch(console.error);
          }
          break

        case 'pause':
          if (booking.status !== 'in_progress' || booking.job_timer_status !== 'running') {
            await connection.query('ROLLBACK')
            return NextResponse.json({ success: false, message: 'Timer is not running' }, { status: 400 })
          }
          await connection.execute(
            `UPDATE bookings SET job_timer_status = 'paused', updated_at = NOW() WHERE id = ?`,
            [booking_id]
          )
          // Close the active job session
          await connection.execute(
            `UPDATE job_sessions SET clock_out = ?, session_duration_minutes = TIMESTAMPDIFF(MINUTE, clock_in, ?) WHERE booking_id = ? AND provider_id = ? AND clock_out IS NULL`,
            [now, now, booking_id, caller.id]
          )
          await connection.execute(
            `INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'pause', ?, ?)`,
            [booking_id, now, notes || 'Job paused / End of Day']
          )
          break

        case 'resume':
          if (booking.status !== 'in_progress' || booking.job_timer_status !== 'paused') {
            await connection.query('ROLLBACK')
            return NextResponse.json({ success: false, message: 'Timer is not paused' }, { status: 400 })
          }
          await connection.execute(
            `UPDATE bookings SET job_timer_status = 'running', updated_at = NOW() WHERE id = ?`,
            [booking_id]
          )
          // Create a new job session
          await connection.execute(
            `INSERT INTO job_sessions (booking_id, provider_id, clock_in) VALUES (?, ?, ?)`,
            [booking_id, caller.id, now]
          )
          await connection.execute(
            `INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'resume', ?, ?)`,
            [booking_id, now, notes || 'Job resumed (New Session)']
          )
          break

        case 'stop': {
          if (booking.status !== 'in_progress') {
            await connection.query('ROLLBACK')
            return NextResponse.json({ success: false, message: 'Job must be in progress to complete' }, { status: 400 })
          }

          // Close any open job session
          await connection.execute(
            `UPDATE job_sessions SET clock_out = ?, session_duration_minutes = TIMESTAMPDIFF(MINUTE, clock_in, ?) WHERE booking_id = ? AND provider_id = ? AND clock_out IS NULL`,
            [now, now, booking_id, caller.id]
          )

          // Calculate total duration from all job sessions
          const [sessions] = await connection.execute(
            `SELECT SUM(session_duration_minutes) as total_mins FROM job_sessions WHERE booking_id = ?`,
            [booking_id]
          )

          let totalMinutes = 0
          if (sessions[0].total_mins) {
            totalMinutes = parseInt(sessions[0].total_mins, 10)
          } else {
            // Fallback to time logs if no sessions exist (for backward compatibility with old active jobs)
            const [logs] = await connection.execute(
              `SELECT * FROM booking_time_logs WHERE booking_id = ? AND action IN ('start', 'pause', 'resume', 'stop') ORDER BY timestamp ASC`,
              [booking_id]
            )
            let lastStart = null
            logs.forEach(log => {
              const logTime = new Date(log.timestamp)
              if (log.action === 'start' || log.action === 'resume') {
                lastStart = logTime
              } else if ((log.action === 'pause' || log.action === 'stop') && lastStart) {
                totalMinutes += Math.round((logTime - lastStart) / 60000)
                lastStart = null
              }
            })
            if (lastStart) {
              totalMinutes += Math.round((now - lastStart) / 60000)
            }
          }

          // Hours and crew entered at the finish are stored as the provider's entries. The payout is the booking's recorded
          // price less its commission; overtime_minutes is the measured time past the service's standard duration.
          const wholeEntry = (value) => (Number.isInteger(value) && value >= 0 && value <= 100000 ? value : null)
          const enteredMinutes = wholeEntry(submitted_duration_minutes)
          const enteredHeadcount = wholeEntry(submitted_headcount)
          const overtimeMinutes = Math.max(0, totalMinutes - standardDuration)
          const finalAmount = providerPayout(booking)

          await connection.execute(
            `UPDATE bookings SET 
              status = 'awaiting_approval',
              end_time = ?,
              actual_duration_minutes = ?,
              submitted_duration_minutes = ?,
              submitted_headcount = ?,
              adjustment_reason = ?,
              overtime_minutes = ?,
              overtime_earnings = 0,
              final_provider_amount = ?,
              job_timer_status = 'completed',
              updated_at = NOW()
             WHERE id = ?`,
            [now, totalMinutes, enteredMinutes, enteredHeadcount, adjustment_reason || null, overtimeMinutes, finalAmount, booking_id]
          )

          await connection.execute(
            `INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'stop', ?, ?)`,
            [booking_id, now, notes || `Job finished. Duration: ${totalMinutes} mins`]
          )

          await connection.execute(
            `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'awaiting_approval', ?)`,
            [booking_id, `Summary: ${work_summary || 'Job done'}. Recommendations: ${recommendations || 'None'}`]
          )

          await connection.query('COMMIT')

          // Send email to customer AFTER commit
          try {
            const [provider] = await execute(
              `SELECT name FROM service_providers WHERE id = ?`,
              [caller.id]
            )

            // Fetch job photos
            const jobPhotos = await execute(
              `SELECT photo_url, photo_type FROM job_photos WHERE booking_id = ?`,
              [booking_id]
            )

            const beforePhotos = jobPhotos.filter(p => p.photo_type === 'before').map(p => p.photo_url)
            const afterPhotos = jobPhotos.filter(p => p.photo_type === 'after').map(p => p.photo_url)

            const providerName = provider?.name || 'Your Provider'
            const customerName = booking.customer_first_name || 'Customer'
            
            const customerBasePrice = parseFloat(booking.service_price || 0)

            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

            const emailHtml = jobCompletedEmailHtml({
              customerName,
              providerName,
              serviceName: booking.service_name,
              bookingNumber: booking.booking_number,
              startTime: booking.start_time,
              finishedAt: now,
              totalMinutes,
              overtimeMinutes,
              price: customerBasePrice,
              workSummary: work_summary,
              recommendations,
              beforePhotos,
              afterPhotos,
              baseUrl,
              bookingId: booking.id
            })

            sendEmail({
              to: booking.customer_email,
              subject: `✅ Job Completed - ${booking.service_name} | Booking #${booking.booking_number}`,
              html: emailHtml,
              text: `Hi ${customerName}, your ${booking.service_name} job has been completed by ${providerName}. Work Summary: ${work_summary || 'Job done'}.${recommendations ? ` Recommendations: ${recommendations}` : ''}`
            }).catch(emailErr => {
              console.error('Email background send failed:', emailErr)
            })

            if (booking.customer_phone) {
              sendSMS(booking.customer_phone, 'Your invoice is ready. Please approve and pay.').catch(console.error);
            }
          } catch (err) {
            console.error('Failed to prepare job completion email:', err)
          }

          return NextResponse.json({
            success: true,
            message: 'Job submitted for customer approval',
            data: {
              total_minutes: enteredMinutes ?? totalMinutes,
              system_minutes: totalMinutes,
              standard_minutes: standardDuration,
              overtime_minutes: overtimeMinutes,
              overtime_rate: overtimeRate,
              overtime_earnings: 0,
              base_earnings: parseFloat(booking.provider_amount),
              total_earnings: finalAmount
            }
          })
        }

        default:
          await connection.query('ROLLBACK')
          return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 })
      }

      await connection.query('COMMIT')

      // Log Activity (the guard's caller carries no name, the old cookie token did: the name is read from the caller's own
      // row on the connection this request already holds, and a failed read is logged and only leaves the fallback, it never
      // fails an action that has been committed)
      let actorName = null
      try {
        const [[actor]] = await connection.execute(`SELECT name FROM service_providers WHERE id = ?`, [caller.id])
        actorName = actor?.name || null
      } catch (nameErr) {
        console.error('Failed to read the provider name:', nameErr)
      }
      logActivity({
        actor_id: caller.id,
        actor_type: 'provider',
        actor_name: actorName || 'Provider',
        action: 'JOB_STATUS_UPDATED',
        entity_type: 'booking',
        entity_id: booking_id,
        details: { status_action: action, service_name: booking.service_name }
      })

      const [[updated]] = await connection.execute(
        `SELECT status, job_timer_status, start_time FROM bookings WHERE id = ?`,
        [booking_id]
      )

      return NextResponse.json({
        success: true,
        message: `Timer ${action}ed successfully`,
        data: updated
      })

    } catch (err) {
      await connection.query('ROLLBACK')
      throw err
    } finally {
      if (connection) connection.release()
    }

  } catch (error) {
    console.error('Error in time tracking:', error)
    return NextResponse.json({ success: false, message: 'Failed to process request: ' + error.message }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { searchParams } = new URL(request.url)
    const booking_id = searchParams.get('booking_id')
    if (!booking_id) return NextResponse.json({ success: false, message: 'booking_id required' }, { status: 400 })

    const bookings = await execute(
      `SELECT 
        b.id, b.status, b.job_timer_status, b.start_time, b.end_time,
        b.worker_count, b.actual_duration_minutes, b.overtime_minutes, b.overtime_earnings,
        b.provider_amount, b.final_provider_amount, b.service_price,
        b.additional_price as overtime_rate,
        s.duration_minutes as standard_duration,
        TIMESTAMPDIFF(MINUTE, b.start_time, NOW()) as current_duration,
        (SELECT COUNT(*) FROM job_photos WHERE booking_id = b.id AND photo_type = 'before') > 0 as has_before_photos,
        (SELECT COUNT(*) FROM job_photos WHERE booking_id = b.id AND photo_type = 'after') > 0 as has_after_photos
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.id = ? AND b.provider_id = ?`,
      [booking_id, caller.id]
    )

    if (bookings.length === 0) return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 })

    const logs = await execute(
      `SELECT * FROM booking_time_logs WHERE booking_id = ? ORDER BY timestamp ASC`,
      [booking_id]
    )

    let totalSeconds = 0;
    let lastStart = null;
    const now = new Date();

    logs.forEach(log => {
      const logTime = new Date(log.timestamp);
      if (log.action === 'start' || log.action === 'resume') {
        lastStart = logTime;
      } else if ((log.action === 'pause' || log.action === 'stop') && lastStart) {
        totalSeconds += Math.round((logTime - lastStart) / 1000);
        lastStart = null;
      }
    });

    // If timer is currently running, add time elapsed since last resume
    if (lastStart && bookings[0].job_timer_status === 'running') {
      totalSeconds += Math.round((now - lastStart) / 1000);
    }

    const jobData = bookings[0];
    jobData.accumulated_seconds = totalSeconds;

    return NextResponse.json({ success: true, data: jobData, logs })

  } catch (error) {
    console.error('Error fetching timer status:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch timer status' }, { status: 500 })
  }
}