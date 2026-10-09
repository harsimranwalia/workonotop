import { NextResponse } from 'next/server';
import { execute, withConnection } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { notifyUser } from '@/lib/push';
import { requireCaller } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

// The caller must be a participant of the booking: its customer (bookings.user_id), its provider (bookings.provider_id)
// or an admin. A guest booking has no user_id, so no customer is a participant of it. Never a 404 for a booking that
// exists (the mobile app logs the user out on a "not found").
const isParticipant = (caller, booking) =>
  caller.role === 'admin' ||
  (caller.role === 'customer' && booking.user_id != null && String(booking.user_id) === String(caller.id)) ||
  (caller.role === 'provider' && booking.provider_id != null && String(booking.provider_id) === String(caller.id));

// GET messages
export async function GET(request) {
  const auth = await requireCaller(request, ['customer', 'provider', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get('bookingId');

    if (!bookingId) {
      return NextResponse.json(
        { success: false, message: 'Booking ID required' },
        { status: 400 }
      );
    }

    // use a single connection for all queries involved in this request
    return await withConnection(async (connection) => {
      // The booking decides who may read: a booking that does not exist keeps the route's existing answer (an empty
      // list and the status 'unknown'); one that exists is read only by a participant or an admin.
      const [bookings] = await connection.execute(
        'SELECT status, user_id, provider_id FROM bookings WHERE id = ?',
        [bookingId]
      );
      if (bookings.length > 0 && !isParticipant(caller, bookings[0])) return forbidden();

      const [messages] = await connection.execute(
        `SELECT * FROM chat_messages 
           WHERE booking_id = ? 
           ORDER BY created_at ASC`,
        [bookingId]
      );

      // Get sender names
      const messagesWithNames = [];
      for (const msg of messages) {
        let sender_name = '';
        if (msg.sender_type === 'customer') {
          const [users] = await connection.execute(
            'SELECT first_name FROM users WHERE id = ?',
            [msg.sender_id]
          );
          sender_name = users[0]?.first_name || 'Customer';
        } else {
          const [providers] = await connection.execute(
            'SELECT name FROM service_providers WHERE id = ?',
            [msg.sender_id]
          );
          sender_name = providers[0]?.name || 'Provider';
        }
        messagesWithNames.push({ ...msg, sender_name });
      }

      // Get booking status (read above, with the participant check)
      const bookingStatus = bookings[0]?.status || 'unknown';

      return NextResponse.json({
        success: true,
        messages: messagesWithNames,
        bookingStatus
      });
    });
  } catch (error) {
    console.error('Chat GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['customer', 'provider', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { bookingId, message } = await request.json();

    if (!bookingId || !message) {
      return NextResponse.json(
        { success: false, message: 'Booking ID and message required' },
        { status: 400 }
      );
    }

    // The sender is the caller, never a field of the body (a body senderType is ignored). chat_messages.sender_type is
    // 'customer' or 'provider' only, so an admin is stored as 'customer' under their own id (the old line stored any
    // token without a providerId that way).
    const senderType = caller.role === 'provider' ? 'provider' : 'customer';
    const senderId = caller.id;

    // perform all database work on a single connection for the whole
    // request.  this prevents the pool from handing out multiple sockets
    // when we could have just reused one.
    return await withConnection(async (connection) => {
      // Check booking exists (404), then that the caller is a participant of it (403)
      const [bookings] = await connection.execute(
        `SELECT id, status, user_id, provider_id FROM bookings WHERE id = ?`,
        [bookingId]
      );

      if (bookings.length === 0) {
        return NextResponse.json(
          { success: false, message: 'Booking not found' },
          { status: 404 }
        );
      }

      if (!isParticipant(caller, bookings[0])) return forbidden();

      // Insert message
      const [result] = await connection.execute(
        `INSERT INTO chat_messages (booking_id, sender_id, sender_type, message) 
         VALUES (?, ?, ?, ?)`,
        [bookingId, senderId, senderType, message]
      );

      // Get inserted message
      const [newMessages] = await connection.execute(
        `SELECT * FROM chat_messages WHERE id = ?`,
        [result.insertId]
      );

      const newMessage = newMessages[0];
      
      // Add sender name
      let sender_name = '';
      if (newMessage.sender_type === 'customer') {
        const [users] = await connection.execute(
          'SELECT first_name FROM users WHERE id = ?',
          [newMessage.sender_id]
        );
        sender_name = users[0]?.first_name || 'Customer';
      } else {
        const [providers] = await connection.execute(
          'SELECT name FROM service_providers WHERE id = ?',
          [newMessage.sender_id]
        );
        sender_name = providers[0]?.name || 'Provider';
      }
      
      newMessage.sender_name = sender_name;

      // ---- NOTIFICATIONS ----
      try {
        const [bookingRes] = await connection.execute(
          'SELECT b.user_id, b.provider_id, b.customer_email, sp.email as provider_email FROM bookings b LEFT JOIN service_providers sp ON b.provider_id = sp.id WHERE b.id = ?',
          [bookingId]
        );
        const booking = bookingRes[0];

        if (booking) {
          const title = 'New Message';
          const msgBody = `${sender_name}: ${message}`;

          if (senderType === 'customer' && booking.provider_id) {
            // Notify Pro
            if (booking.provider_email) {
              await sendEmail({ to: booking.provider_email, subject: title, text: msgBody }).catch(console.error);
            }
            await notifyUser(booking.provider_id, 'provider', title, msgBody, { booking_id: bookingId }).catch(console.error);
          } else if (senderType === 'provider' && booking.user_id) {
            // Notify Client
            if (booking.customer_email) {
              await sendEmail({ to: booking.customer_email, subject: title, text: msgBody }).catch(console.error);
            }
            await notifyUser(booking.user_id, 'customer', title, msgBody, { booking_id: bookingId }).catch(console.error);
          }
        }
      } catch (notifErr) {
        console.error('Failed to send chat push/email:', notifErr);
      }
      // -----------------------


      return NextResponse.json({
        success: true,
        message: newMessage
      });
    });

  } catch (error) {
    console.error('Chat POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}