// app/api/provider/available-jobs/[id]/route.js
import { NextResponse } from 'next/server'
import { execute, getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { notifyUser } from '@/lib/push'
import { sendEmail } from '@/lib/email'
import { logActivity } from '@/lib/logger'

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })

// Helper to get system settings
async function getSystemSetting(key, defaultValue = null) {
  try {
    const results = await execute('SELECT `value` FROM system_settings WHERE `key` = ?', [key])
    return results && results.length > 0 ? results[0].value : defaultValue
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error)
    return defaultValue
  }
}

// ── GET: Job detail ───────────────────────────────────────────────────────────
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { id } = await params

    const defaultCommRaw = await getSystemSetting('default_commission', '20')
    const defaultComm = parseFloat(defaultCommRaw)

    const results = await execute(
      `SELECT
        b.id, b.booking_number, b.service_name, b.job_date, b.job_time_slot,
        b.address_line1, b.address_line2, b.city, b.postal_code,
        b.job_description, b.instructions, b.timing_constraints,
        b.parking_access, b.elevator_access, b.has_pets,
        b.status, b.provider_id, b.created_at,
        b.provider_amount, b.commission_percent,
        b.service_price as base_price,
        b.additional_price as overtime_rate,
        s.duration_minutes AS service_duration,
        c.name AS category_name, c.icon AS category_icon
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN service_categories c ON s.category_id = c.id
      WHERE b.id = ? AND (b.provider_id = ? OR (b.provider_id IS NULL AND b.status IN ('pending', 'matching')))`,
      [id, caller.id]
    )

    if (!results.length) {
      // A booking that exists but is another provider's, or is neither the caller's nor open to providers, is a 403, never the 404 below; one that does not exist keeps the 404.
      const [existing] = await execute('SELECT id FROM bookings WHERE id = ?', [id])
      if (existing) return forbidden()
      return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 })
    }

    const booking = { ...results[0] }

    const photos = await execute(
      'SELECT photo_url FROM booking_photos WHERE booking_id = ? ORDER BY created_at ASC',
      [id]
    )
    booking.photos = photos.map(p => p.photo_url)

    if (booking.job_time_slot) booking.job_time_slot = booking.job_time_slot.split(',')

    booking.base_price = parseFloat(booking.base_price || 0)
    booking.overtime_rate = parseFloat(booking.overtime_rate || 0)
    booking.provider_amount = parseFloat(booking.provider_amount || 0)
    booking.commission_percent = booking.commission_percent !== null ? parseFloat(booking.commission_percent) : defaultComm
    booking.service_duration = booking.service_duration || 60

    const commAmt = booking.base_price * (booking.commission_percent / 100)
    const baseEarnings = booking.base_price - commAmt
    const netOT = booking.overtime_rate * (1 - booking.commission_percent / 100)

    booking.breakdown = {
      base_price: booking.base_price,
      commission_percent: booking.commission_percent,
      commission_amount: commAmt,
      provider_base: baseEarnings,
      overtime_rate: booking.overtime_rate,
      net_overtime_rate: netOT,
      total_provider_amount: booking.provider_amount || baseEarnings,
      duration_minutes: booking.service_duration,
      one_hour_overtime_total: baseEarnings + netOT,
      two_hour_overtime_total: baseEarnings + netOT * 2,
    }

    let availability_reason = null
    const isAvailable = booking.provider_id === null && ['pending', 'matching'].includes(booking.status)

    if (!isAvailable) {
      if (booking.provider_id !== null) availability_reason = 'already_accepted'
      else availability_reason = 'not_available'
    }

    const isMyJob = booking.provider_id === caller.id

    return NextResponse.json({
      success: true,
      data: booking,
      is_available: isAvailable,
      is_my_job: isMyJob,
      availability_reason
    })

  } catch (error) {
    console.error('Error fetching job:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch job' }, { status: 500 })
  }
}

// ── POST: Accept job ──────────────────────────────────────────────────────────
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  let connection
  try {
    const { id } = await params

    const defaultCommRaw = await getSystemSetting('default_commission', '20')
    const defaultComm = parseFloat(defaultCommRaw)

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      const [[job]] = await connection.execute(
        `SELECT b.id, b.provider_id, b.status, b.provider_amount, b.service_name,
                b.commission_percent, b.service_price, b.additional_price as overtime_rate,
                s.duration_minutes as service_duration
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         WHERE b.id = ? FOR UPDATE`,
        [id]
      )

      if (!job) { await connection.query('ROLLBACK'); return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 }) }

      // Ownership, on the locked row: the caller's own job, or an unassigned one open to providers (the clause jobs/[id] has). Another provider's job,
      // or one that is neither, is a 403, never the 409 below (it stays for the caller's own job, which has a provider already).
      if (!(job.provider_id === caller.id || (job.provider_id === null && ['pending', 'matching'].includes(job.status)))) {
        await connection.query('ROLLBACK')
        return forbidden()
      }

      const commPct = job.commission_percent !== null ? parseFloat(job.commission_percent) : defaultComm

      if (job.provider_id !== null) { await connection.query('ROLLBACK'); return NextResponse.json({ success: false, message: 'Already accepted by another provider' }, { status: 409 }) }

      // Update commission if null
      if (job.commission_percent === null) {
        await connection.execute('UPDATE bookings SET commission_percent = ? WHERE id = ?', [commPct, id])
      }

      await connection.execute(
        `UPDATE bookings SET provider_id=?, status='confirmed', accepted_at=NOW(), updated_at=NOW() WHERE id=?`,
        [caller.id, id]
      )
      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'confirmed', ?)`,
        [id, `Accepted by provider #${caller.id}`]
      )

      await connection.query('COMMIT')

      // The old token carried the provider's name; auth.caller does not, so read it (a failure here must not undo a committed accept).
      let providerName = null
      try {
        const [providerRow] = await execute('SELECT name FROM service_providers WHERE id = ?', [caller.id])
        providerName = providerRow?.name ?? null
      } catch (nameErr) {
        console.error('Failed to read the provider name:', nameErr)
      }

      // Log Activity
      logActivity({
        actor_id: caller.id,
        actor_type: 'provider',
        actor_name: providerName || 'Provider',
        action: 'JOB_ACCEPTED',
        entity_type: 'booking',
        entity_id: id,
        details: { service_name: job.service_name }
      })

      // ---- NOTIFICATIONS ----
      try {
        const titleClient = 'Pro Accepted Your Job!';
        const bodyClient = `${providerName || 'A professional'} has accepted your ${job.service_name} job.`;
        
        if (job.user_id) {
          await notifyUser(job.user_id, 'customer', titleClient, bodyClient, { booking_id: id }).catch(console.error);
        }
        if (job.customer_email) {
          await sendEmail({ to: job.customer_email, subject: titleClient, text: bodyClient }).catch(console.error);
        }

        const titlePro = 'Job Accepted';
        const bodyPro = `You have successfully accepted the ${job.service_name} job.`;
        await notifyUser(caller.id, 'provider', titlePro, bodyPro, { booking_id: id }).catch(console.error);
        
        // Let's get pro email to send it there too
        const [proData] = await connection.execute('SELECT email FROM service_providers WHERE id = ?', [caller.id]);
        if (proData && proData[0] && proData[0].email) {
          await sendEmail({ to: proData[0].email, subject: titlePro, text: bodyPro }).catch(console.error);
        }
      } catch (notifErr) {
        console.error('Failed to send accept job notifications:', notifErr);
      }
      // -----------------------

      const otRate = parseFloat(job.overtime_rate || 0)
      const netOT = otRate * (1 - commPct / 100)
      const baseEarnings = parseFloat(job.service_price || 0) * (1 - commPct / 100)

      const response = {
        success: true,
        message: `Job accepted: ${job.service_name}`,
        provider_amount: job.provider_amount || baseEarnings,
      }

      if (otRate > 0) {
        response.overtime_info = {
          rate_per_hour: otRate,
          net_rate_per_hour: netOT,
          message: `Overtime available at $${otRate.toFixed(2)}/hr.`,
          potential: { one_hour: baseEarnings + netOT, two_hour: baseEarnings + netOT * 2 }
        }
      }

      return NextResponse.json(response)

    } catch (err) {
      await connection.query('ROLLBACK')
      throw err
    } finally {
      if (connection) connection.release()
    }

  } catch (error) {
    console.error('Error accepting job:', error)
    return NextResponse.json({ success: false, message: 'Failed to accept job: ' + error.message }, { status: 500 })
  }
}