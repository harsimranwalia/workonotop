import { NextResponse } from 'next/server'
import { withConnection, execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { clearBookingCrew } from '@/lib/booking-crew'
import { afterCommit } from '@/lib/notices'
import { noticeAssigned } from '@/lib/notice-events'

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
        // The job starts again, so the crew its old provider picked goes with the round (ENG-014).
        await clearBookingCrew(connection, id)

        // Update booking - assign new provider and reset
        // Writing provider_id clears the push marker: a job reaches providers only through a push made while it has no provider.
        await connection.execute(
          `UPDATE bookings 
           SET provider_id = ?,
               previous_provider_id = ?,
               status = 'pending',
               job_timer_status = 'not_started',
               start_time = NULL,
               end_time = NULL,
               accepted_at = NULL,
               marketplace_pushed_at = NULL,
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

        // The new provider is told by text and by e-mail once this answer has gone, and the old one is not (ENG-018). The push that stood here named an
        // `execute` this file never imported, so it never went.
        afterCommit(() => noticeAssigned(execute, { bookingId: Number(id), providerId: Number(new_provider_id) }))

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