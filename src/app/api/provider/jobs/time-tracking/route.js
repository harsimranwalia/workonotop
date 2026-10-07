// app/api/provider/jobs/time-tracking/route.js
import { NextResponse } from 'next/server'
import { execute, getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'
import { notifyUser } from '@/lib/push'
import { logActivity } from '@/lib/logger'
import { sendSMS } from '@/lib/sms'
import { providerPayout } from '@/lib/booking-price'

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

            const formatDuration = (mins) => {
              if (!mins) return 'N/A'
              const h = Math.floor(mins / 60)
              const m = mins % 60
              if (h > 0 && m > 0) return `${h}h ${m}m`
              if (h > 0) return `${h}h`
              return `${m} min`
            }

            const formatDateTime = (dt) => {
              if (!dt) return 'N/A'
              return new Date(dt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              })
            }

            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
            const approveUrl = `${baseUrl}/my-bookings/${booking_id}?action=approve`
            const disputeUrl = `${baseUrl}/my-bookings/${booking_id}?action=dispute`

            const getAbsoluteUrl = (url) => {
              if (!url) return ''
              if (url.startsWith('http')) return url
              return `${baseUrl}${url}`
            }

            const renderPhotoSection = (label, photos, color) => {
              if (!photos || photos.length === 0) return ''
              return `
                <div style="margin-top: 24px;">
                  <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.5px;">📸 ${label} Photos</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:0;">
                        ${photos.map(url => `
                          <div style="display:inline-block;width:170px;margin-right:10px;margin-bottom:10px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;background:#f8fafc;">
                            <img src="${getAbsoluteUrl(url)}" alt="${label}" style="width:170px;height:170px;object-cover;display:block;" />
                          </div>
                        `).join('')}
                      </td>
                    </tr>
                  </table>
                </div>
              `
            }

            const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:20px;">
          <span style="font-size:22px;font-weight:700;color:#0f766e;letter-spacing:-0.5px;">Work<span style="color:#0891b2;">On</span>Tap</span>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="background:linear-gradient(135deg,#15803d 0%,#0891b2 100%);padding:40px 32px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">✅</div>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Job Completed!</h1>
            </td></tr>
          </table>

          <!-- Body -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:36px 40px 32px;">

              <p style="margin:0 0 6px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${customerName} 👋</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
                Your <strong>${booking.service_name}</strong> service has been completed by <strong>${providerName}</strong>.
                Here's a full summary of the work done.
              </p>

              <!-- Job Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:20px 24px;">
                  <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Job Details</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;width:140px;">Booking #</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${booking.booking_number}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Service</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${booking.service_name}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Provider</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${providerName}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Started</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${formatDateTime(booking.start_time)}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Completed</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${formatDateTime(now)}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Duration</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:700;color:#16a34a;">${formatDuration(totalMinutes)}</td>
                    </tr>
                    ${overtimeMinutes > 0 ? `
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Overtime</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#15843E;">${formatDuration(overtimeMinutes)}</td>
                    </tr>
                    ` : ''}
                  </table>
                </td></tr>
              </table>

              <!-- Invoice Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:20px 24px;">
                  <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Invoice Summary</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Base Price</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;">$${customerBasePrice.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding:10px 0;"><hr style="border:none;border-top:1px solid #e2e8f0;" /></td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:16px;font-weight:700;color:#0f172a;">Total Amount Due</td>
                      <td style="padding:5px 0;font-size:18px;font-weight:800;color:#16a34a;text-align:right;">$${customerBasePrice.toFixed(2)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>

              <!-- Work Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #86efac;border-left:4px solid #16a34a;border-radius:8px;margin-bottom:24px;">
                <tr><td style="padding:18px 20px;">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">✅ Work Summary</p>
                  <p style="margin:0;font-size:14px;color:#166534;line-height:1.7;">${work_summary || 'Job completed successfully.'}</p>
                </td></tr>
              </table>

              ${recommendations ? `
              <!-- Recommendations -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:8px;margin-bottom:24px;">
                <tr><td style="padding:18px 20px;">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px;">🔧 Recommendations</p>
                  <p style="margin:0;font-size:14px;color:#7c2d12;line-height:1.7;">${recommendations}</p>
                </td></tr>
              </table>
              ` : ''}

              <!-- Photos Section -->
              ${renderPhotoSection('Before', beforePhotos, '#f97316')}
              ${renderPhotoSection('After', afterPhotos, '#16a34a')}

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 24px;" />

              <!-- CTA Buttons -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:0 10px;">
                          <a href="${approveUrl}"
                             style="display:inline-block;padding:14px 30px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;box-shadow:0 4px 12px rgba(22,163,74,0.2);">
                            ✅ Accept & Pay
                          </a>
                        </td>
                        <td style="padding:0 10px;">
                          <a href="${disputeUrl}"
                             style="display:inline-block;padding:14px 30px;background:#ffffff;color:#dc2626;text-decoration:none;border:2px solid #dc2626;border-radius:10px;font-size:15px;font-weight:700;">
                            ⚠️ Dispute
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.7;text-align:center;">
                If no action is taken, the job will be automatically approved in 12 hours.
              </p>

              <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;line-height:1.7;text-align:center;">
                Questions? Contact us at <a href="mailto:support@workontap.com" style="color:#0891b2;text-decoration:none;">support@workontap.com</a>
              </p>

            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;font-size:13px;color:#94a3b8;">© ${new Date().getFullYear()} WorkOnTap · Calgary, Alberta, Canada</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

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