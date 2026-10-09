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

export async function GET(request) {
  const auth = await requireCaller(request, ['customer', 'provider', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get('bookingId');
    const userType = searchParams.get('userType');

    if (!bookingId || !userType) {
      return NextResponse.json(
        { success: false, message: 'Missing parameters' },
        { status: 400 }
      );
    }

    // The count is for the caller only: a userType naming the other side, or a user_id or provider_id naming another
    // account, is a 403 (an admin may name either side and any account).
    const named = searchParams.get('user_id') ?? searchParams.get('provider_id');
    if (caller.role !== 'admin') {
      if (userType !== caller.role) return forbidden();
      if (named !== null && named !== '' && String(named) !== String(caller.id)) return forbidden();
    }

    // The caller must be a participant of the booking. A booking that does not exist keeps the route's existing
    // answer (a count of 0).
    const [booking] = await execute('SELECT user_id, provider_id FROM bookings WHERE id = ?', [bookingId]);
    if (booking && !isParticipant(caller, booking)) return forbidden();

    // Get user ID: the caller's own (an admin who names an account gets that account's count)
    const userId = caller.role === 'admin' && named ? named : caller.id;

    // Count unread messages where sender is NOT the current user
    const result = await execute(
      `SELECT COUNT(*) as count 
       FROM chat_messages 
       WHERE booking_id = ? 
         AND sender_type != ? 
         AND sender_id != ? 
         AND is_read = 0`,
      [bookingId, userType, userId]
    );

    return NextResponse.json({
      success: true,
      unreadCount: result[0]?.count || 0
    });

  } catch (error) {
    console.error('Unread count error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}