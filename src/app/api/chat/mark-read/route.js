import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

// The caller must be a participant of the booking: its customer (bookings.user_id), its provider (bookings.provider_id)
// or an admin. A guest booking has no user_id, so no customer is a participant of it. Never a 404 for a booking that
// exists (the mobile app logs the user out on a "not found").
const isParticipant = (caller, booking) =>
  caller.role === 'admin' ||
  (caller.role === 'customer' && booking.user_id != null && String(booking.user_id) === String(caller.id)) ||
  (caller.role === 'provider' && booking.provider_id != null && String(booking.provider_id) === String(caller.id));

export async function POST(request) {
  const auth = await requireCaller(request, ['customer', 'provider', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { bookingId, userType } = await request.json();

    if (!bookingId || !userType) {
      return NextResponse.json(
        { success: false, message: 'Missing parameters' },
        { status: 400 }
      );
    }

    // The caller marks only their own side: a userType naming the other side is a 403 (an admin may name either).
    if (caller.role !== 'admin' && userType !== caller.role) return forbidden();

    // The caller must be a participant of the booking. A booking that does not exist keeps the route's existing
    // answer (nothing to mark, success).
    const [booking] = await execute('SELECT user_id, provider_id FROM bookings WHERE id = ?', [bookingId]);
    if (booking && !isParticipant(caller, booking)) return forbidden();

    // Mark messages as read where sender is not the current user
    await execute(
      `UPDATE chat_messages 
       SET is_read = 1 
       WHERE booking_id = ? 
         AND sender_type != ? 
         AND is_read = 0`,
      [bookingId, userType]
    );

    return NextResponse.json({
      success: true,
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Mark read error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}