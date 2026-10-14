import { NextResponse } from 'next/server'
import { getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { logActivity } from '@/lib/logger'
import { notifyMatchingProviders } from '@/lib/marketplace'

// Admin only: puts a job with no provider on the marketplace; a second push answers already and sends nothing.
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection
  try {
    const { id } = await params

    connection = await getConnection()

    try {
      await connection.query('START TRANSACTION')

      const [[booking]] = await connection.execute(
        `SELECT id, provider_id, status, marketplace_pushed_at, service_id, service_name, service_price,
                city, cluster, job_date, job_time_slot, standard_duration_minutes
         FROM bookings WHERE id = ? FOR UPDATE`,
        [id]
      )

      if (!booking) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 })
      }

      if (booking.provider_id !== null) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: 'This job already has a provider.' }, { status: 409 })
      }

      if (!['pending', 'matching'].includes(booking.status)) {
        await connection.query('ROLLBACK')
        return NextResponse.json(
          { success: false, message: 'Only a job waiting for a provider can be pushed to the marketplace.' },
          { status: 409 }
        )
      }

      if (booking.marketplace_pushed_at) {
        await connection.query('ROLLBACK')
        return NextResponse.json({
          success: true,
          already: true,
          marketplace_pushed_at: booking.marketplace_pushed_at,
          message: 'This job is already on the marketplace.'
        })
      }

      await connection.execute('UPDATE bookings SET marketplace_pushed_at = NOW(), updated_at = NOW() WHERE id = ?', [id])
      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, ?, 'Pushed to the marketplace')`,
        [id, booking.status]
      )
      const [[pushed]] = await connection.execute('SELECT marketplace_pushed_at FROM bookings WHERE id = ?', [id])

      await connection.query('COMMIT')

      logActivity({
        actor_id: Number(auth.caller.id), actor_type: 'admin', actor_name: 'Admin',
        action: 'JOB_PUSHED_TO_MARKETPLACE', entity_type: 'booking', entity_id: booking.id
      })

      // Run in the background: a failure to notify is logged and never undoes the push.
      notifyMatchingProviders(booking)

      return NextResponse.json({
        success: true,
        marketplace_pushed_at: pushed.marketplace_pushed_at,
        message: 'Job pushed to the marketplace.'
      })
    } catch (err) {
      await connection.query('ROLLBACK')
      throw err
    } finally {
      connection.release()
    }
  } catch (error) {
    console.error('Error pushing job to the marketplace:', error)
    return NextResponse.json({ success: false, message: 'Failed to push job to the marketplace' }, { status: 500 })
  }
}
