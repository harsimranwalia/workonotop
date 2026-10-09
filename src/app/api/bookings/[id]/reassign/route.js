import { NextResponse } from 'next/server'
import { withConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params
    const { new_provider_id, old_provider_id } = await request.json()

    if (!new_provider_id) {
      return NextResponse.json(
        { success: false, message: 'New provider ID required' },
        { status: 400 }
      )
    }

    return await withConnection(async (connection) => {
      await connection.beginTransaction()

      try {
        // Update booking - assign new provider and reset
        await connection.execute(
          `UPDATE bookings 
           SET provider_id = ?,
               previous_provider_id = ?,
               status = 'pending',
               job_timer_status = 'not_started',
               start_time = NULL,
               end_time = NULL,
               accepted_at = NULL,
               updated_at = NOW()
           WHERE id = ?`,
          [new_provider_id, old_provider_id || null, id]
        )

        // Add status history
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes, created_at)
           VALUES (?, 'disputed', ?, NOW()),
                  (?, 'pending', 'Booking restarted with new provider', NOW())`,
          [
            id, `Dispute resolved - Reassigned to new provider`,
            id
          ]
        )

        await connection.commit()

        // 🔔 Notify new provider (non-blocking)
        try {
          const [[bookingData]] = await connection.execute('SELECT booking_number FROM bookings WHERE id = ?', [id]);
          if (bookingData) {
            import('@/lib/push').then(({ notifyUser }) => {
              notifyUser(new_provider_id, 'New Job Assigned', `You have been reassigned to #${bookingData.booking_number}`, { bookingId: id, type: 'new_job' }, execute, 'provider').catch(() => {});
            });
          }
        } catch (_) {}

        return NextResponse.json({ success: true, message: 'Provider reassigned successfully' })
      } catch (err) {
        await connection.rollback()
        throw err
      }
    })
  } catch (error) {
    console.error('Reassign error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to reassign provider' },
      { status: 500 }
    )
  }
}