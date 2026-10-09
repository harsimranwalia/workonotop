import { NextResponse } from 'next/server'
import { withConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params

    return await withConnection(async (connection) => {
      await connection.beginTransaction()

      try {
        // Get current provider
        const [[booking]] = await connection.execute(
          'SELECT provider_id FROM bookings WHERE id = ?',
          [id]
        )

        // Update booking - remove provider and reset
        await connection.execute(
          `UPDATE bookings 
           SET provider_id = NULL,
               previous_provider_id = ?,
               status = 'pending',
               job_timer_status = 'not_started',
               start_time = NULL,
               end_time = NULL,
               accepted_at = NULL,
               updated_at = NOW()
           WHERE id = ?`,
          [booking?.provider_id || null, id]
        )

        // Add status history
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes, created_at)
           VALUES (?, 'restarted', 'Booking restarted by admin - Provider removed', NOW())`,
          [id]
        )

        await connection.commit()
        return NextResponse.json({ success: true, message: 'Booking restarted successfully' })
      } catch (err) {
        await connection.rollback()
        throw err
      }
    })
  } catch (error) {
    console.error('Restart error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to restart booking' },
      { status: 500 }
    )
  }
}