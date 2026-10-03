// app/api/bookings/[id]/route.js
import { NextResponse } from 'next/server'
import { withConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params

    return await withConnection(async (connection) => {

      // ── 1. Main booking ───────────────────────────────────────────────────
      const [results] = await connection.execute(`
        SELECT 
          b.*,
          s.name             AS service_name,
          s.slug             AS service_slug,
          s.image_url        AS service_image,
          s.description      AS service_description,
          s.duration_minutes AS service_duration,
          c.name             AS category_name,
          c.icon             AS category_icon,
          sp.name            AS provider_name,
          sp.phone           AS provider_phone,
          sp.email           AS provider_email,
          sp.rating          AS provider_rating
        FROM bookings b
        LEFT JOIN services           s  ON b.service_id  = s.id
        LEFT JOIN service_categories c  ON s.category_id = c.id
        LEFT JOIN service_providers  sp ON b.provider_id = sp.id
        WHERE b.id = ? OR b.booking_number = ?
        LIMIT 1
      `, [id, id])

      if (results.length === 0) {
        return NextResponse.json(
          { success: false, message: 'Booking not found' },
          { status: 404 }
        )
      }

      const booking = results[0]
      const bookingId = booking.id

      // ── 2. All sub-queries in parallel (faster + same connection) ─────────
      const [
        [customerPhotos],
        [beforePhotos],
        [afterPhotos],
        [history],
      ] = await Promise.all([
        connection.execute(
          `SELECT photo_url FROM booking_photos 
           WHERE booking_id = ? ORDER BY created_at ASC`,
          [bookingId]
        ),
        connection.execute(
          `SELECT photo_url, uploaded_at FROM job_photos 
           WHERE booking_id = ? AND photo_type = 'before' 
           ORDER BY uploaded_at ASC`,
          [bookingId]
        ),
        connection.execute(
          `SELECT photo_url, uploaded_at FROM job_photos 
           WHERE booking_id = ? AND photo_type = 'after' 
           ORDER BY uploaded_at ASC`,
          [bookingId]
        ),
        connection.execute(
          `SELECT id, status, notes, created_at 
           FROM booking_status_history 
           WHERE booking_id = ? ORDER BY created_at DESC`,
          [bookingId]
        ),
      ])

      // ── 3. Attach results ─────────────────────────────────────────────────
      booking.photos         = customerPhotos.map(p => p.photo_url)
      booking.before_photos  = beforePhotos.map(p => ({ url: p.photo_url, uploaded_at: p.uploaded_at }))
      booking.after_photos   = afterPhotos.map(p => ({ url: p.photo_url, uploaded_at: p.uploaded_at }))
      booking.status_history = history

      // ── 4. Parse time slots ───────────────────────────────────────────────
      if (booking.job_time_slot) {
        booking.job_time_slot = booking.job_time_slot.split(',')
      }

      // ── 5. Parse numerics ─────────────────────────────────────────────────
      booking.service_price         = parseFloat(booking.service_price         || 0)
      booking.additional_price      = parseFloat(booking.additional_price      || 0)
      booking.provider_amount       = parseFloat(booking.provider_amount       || 0)
      booking.overtime_earnings     = parseFloat(booking.overtime_earnings     || 0)
      booking.authorized_amount     = booking.authorized_amount     != null ? parseFloat(booking.authorized_amount)     : null
      booking.final_provider_amount = booking.final_provider_amount != null ? parseFloat(booking.final_provider_amount) : null
      booking.commission_percent    = booking.commission_percent    != null ? parseFloat(booking.commission_percent)    : null
      booking.duration_minutes      = booking.service_duration || 60

      return NextResponse.json({ success: true, data: booking })
    })

  } catch (error) {
    console.error('Booking fetch error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch booking: ' + error.message },
      { status: 500 }
    )
  }
}













