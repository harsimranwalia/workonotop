// import { NextResponse } from 'next/server';
// import { getConnection } from '@/lib/db';
// import { verifyToken } from '@/lib/jwt';

// export async function GET(request) {
//   try {
//     // Get token from cookie
//     const token = request.cookies.get('customer_token')?.value;
//     if (!token) {
//       return NextResponse.json(
//         { success: false, message: 'Unauthorized' },
//         { status: 401 }
//       );
//     }

//     // Verify token
//     const decoded = verifyToken(token);
//     if (!decoded) {
//       return NextResponse.json(
//         { success: false, message: 'Invalid token' },
//         { status: 401 }
//       );
//     }

//     // Get booking ID from URL
//     const { searchParams } = new URL(request.url);
//     const bookingId = searchParams.get('bookingId');

//     if (!bookingId) {
//       return NextResponse.json(
//         { success: false, message: 'Booking ID is required' },
//         { status: 400 }
//       );
//     }

//     const connection = await getConnection();

//     // Get booking details with all related data - Using correct table names
//     const [bookings] = await connection.execute(
//       `SELECT 
//         b.*,
//         s.name as service_name,
//         s.duration_minutes as service_duration,
//         s.slug as service_slug,
//         s.image_url as service_image,
//         s.base_price as service_base_price,
//         sc.name as category_name,
//         sp.name as provider_name,
//         sp.phone as provider_phone,
//         sp.email as provider_email,
//         sp.rating as provider_rating,
//         sp.avatar_url as provider_avatar,
//         GROUP_CONCAT(DISTINCT bp.photo_url) as photos
//       FROM bookings b
//       LEFT JOIN services s ON b.service_id = s.id
//       LEFT JOIN service_categories sc ON s.category_id = sc.id
//       LEFT JOIN service_providers sp ON b.provider_id = sp.id
//       LEFT JOIN booking_photos bp ON b.id = bp.booking_id
//       WHERE b.id = ? AND b.user_id = ?
//       GROUP BY b.id`,
//       [bookingId, decoded.id]
//     );

//     connection.release();

//     if (!bookings || bookings.length === 0) {
//       return NextResponse.json(
//         { success: false, message: 'Booking not found' },
//         { status: 404 }
//       );
//     }

//     const booking = bookings[0];

//     // Parse photos
//     let photos = [];
//     if (booking.photos) {
//       photos = booking.photos.split(',');
//     }
//     delete booking.photos;

//     // Parse job_time_slot if it's a string
//     if (booking.job_time_slot && typeof booking.job_time_slot === 'string') {
//       try {
//         booking.job_time_slot = JSON.parse(booking.job_time_slot);
//       } catch {
//         booking.job_time_slot = booking.job_time_slot.split(',').map(s => s.trim());
//       }
//     }

//     // Calculate final amounts
//     const basePrice = parseFloat(booking.service_price) || 0;
//     const overtimeEarnings = parseFloat(booking.overtime_earnings) || 0;
//     const finalAmount = basePrice + overtimeEarnings;

//     // Return in the format your frontend expects
//     return NextResponse.json({
//       success: true,
//       data: [{
//         ...booking,
//         photos: photos,
//         display: {
//           base_price: basePrice,
//           overtime_earnings: overtimeEarnings,
//           customer_total: finalAmount,
//           provider_gets: parseFloat(booking.final_provider_amount || booking.provider_amount || 0),
//           has_overtime: overtimeEarnings > 0,
//           overtime_minutes: booking.overtime_minutes || 0,
//           overtime_rate: parseFloat(booking.additional_price || 0),
//           standard_duration: booking.service_duration || booking.standard_duration_minutes || 60,
//           actual_duration: booking.actual_duration_minutes || 0
//         }
//       }]
//     });

//   } catch (error) {
//     console.error('Booking details error:', error);
//     return NextResponse.json(
//       { success: false, message: 'Failed to load booking details' },
//       { status: 500 }
//     );
//   }
// }







// app/api/customer/booking-details/route.js
import { NextResponse } from 'next/server'
import { withConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { searchParams } = new URL(request.url)
    const bookingId = searchParams.get('bookingId')
    
    console.log(`🔍 [API BookingDetails] UserID: ${caller.id}, ReqBookingID: ${bookingId}, Decoded:`, caller);

    if (!bookingId) {
      return NextResponse.json({ success: false, message: 'Booking ID required' }, { status: 400 })
    }

    return await withConnection(async (connection) => {
      // ── Main booking ──────────────────────────────────────────────────────
      const [bookings] = await connection.execute(`
        SELECT
          b.*,
          s.name             AS service_name,
          s.slug             AS service_slug,
          s.image_url        AS service_image,
          s.description      AS service_description,
          s.duration_minutes AS service_duration,
          sc.name            AS category_name,
          sp.name            AS provider_name,
          sp.phone           AS provider_phone,
          sp.email           AS provider_email,
          sp.rating          AS provider_rating,
          sp.avatar_url      AS provider_avatar
        FROM bookings b
        LEFT JOIN services           s  ON b.service_id  = s.id
        LEFT JOIN service_categories sc ON s.category_id = sc.id
        LEFT JOIN service_providers  sp ON b.provider_id = sp.id
        WHERE b.id = ? AND b.user_id = ?
        LIMIT 1
      `, [bookingId, caller.id])

      if (!bookings || bookings.length === 0) {
        // A booking that exists but is not the caller's own is a 403, never the 404 below; one that does not exist keeps the 404.
        const [existing] = await connection.execute('SELECT id FROM bookings WHERE id = ?', [bookingId])
        if (existing.length > 0) {
          return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
        }
        return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 })
      }

      const booking = bookings[0]
      const bId = booking.id

      // ── Sub-queries in parallel ───────────────────────────────────────────
      const [
        [customerPhotos],
        [beforePhotos],
        [afterPhotos],
        [history],
      ] = await Promise.all([
        connection.execute(
          `SELECT photo_url FROM booking_photos WHERE booking_id = ? ORDER BY created_at ASC`,
          [bId]
        ),
        connection.execute(
          `SELECT photo_url, uploaded_at FROM job_photos
           WHERE booking_id = ? AND photo_type = 'before' ORDER BY uploaded_at ASC`,
          [bId]
        ),
        connection.execute(
          `SELECT photo_url, uploaded_at FROM job_photos
           WHERE booking_id = ? AND photo_type = 'after' ORDER BY uploaded_at ASC`,
          [bId]
        ),
        connection.execute(
          `SELECT id, status, notes, created_at FROM booking_status_history
           WHERE booking_id = ? ORDER BY created_at DESC`,
          [bId]
        ),
      ])

      booking.photos        = customerPhotos.map(p => p.photo_url)
      booking.before_photos = beforePhotos.map(p => ({ url: p.photo_url, uploaded_at: p.uploaded_at }))
      booking.after_photos  = afterPhotos.map(p => ({ url: p.photo_url, uploaded_at: p.uploaded_at }))
      booking.status_history = history.filter((h, idx) => idx === 0 || h.status !== history[idx - 1].status)

      // ── Parse time slot ───────────────────────────────────────────────────
      if (booking.job_time_slot && typeof booking.job_time_slot === 'string') {
        booking.job_time_slot = booking.job_time_slot.split(',').map(s => s.trim())
      }

      // ── Parse numerics ────────────────────────────────────────────────────
      booking.service_price         = parseFloat(booking.service_price         || 0)
      booking.additional_price      = parseFloat(booking.additional_price      || 0)
      booking.provider_amount       = parseFloat(booking.provider_amount       || 0)
      booking.overtime_earnings     = parseFloat(booking.overtime_earnings     || 0)
      booking.overtime_minutes      = parseInt(booking.overtime_minutes        || 0)
      booking.actual_duration_minutes = parseInt(booking.actual_duration_minutes || 0)
      booking.authorized_amount     = booking.authorized_amount     != null ? parseFloat(booking.authorized_amount)     : null
      booking.final_provider_amount = booking.final_provider_amount != null ? parseFloat(booking.final_provider_amount) : null
      booking.commission_percent    = booking.commission_percent    != null ? parseFloat(booking.commission_percent)    : null
      booking.standard_duration_minutes = parseInt(booking.standard_duration_minutes || booking.service_duration || 60)

      return NextResponse.json({ success: true, data: [booking] })
    })

  } catch (error) {
    console.error('Booking details error:', error)
    return NextResponse.json({ success: false, message: 'Failed to load booking details' }, { status: 500 })
  }
}