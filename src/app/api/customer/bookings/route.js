// app/api/customer/bookings/route.js - FINAL
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

// A customer may name only themselves. A user_id (compared as strings) or an email (compared without case) that
// names anyone else is a 403, never a 404 (the mobile app logs the user out on a "not found"). An admin may name anyone.
function namesAnotherAccount(caller, userId, email) {
  if (userId !== null && userId !== undefined && userId !== '' && String(userId) !== String(caller.id)) return true
  if (email && String(email).toLowerCase() !== String(caller.email ?? '').toLowerCase()) return true
  return false
}

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })

// GET customer's bookings
export async function GET(request) {
  const auth = await requireCaller(request, ['customer', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { searchParams } = new URL(request.url)
    let userId = searchParams.get('user_id')
    let email = searchParams.get('email')

    if (caller.role === 'customer') {
      // The customer is the caller: a parameter naming anyone else is refused, and none at all means their own bookings.
      if (namesAnotherAccount(caller, userId, email)) return forbidden()
      userId = String(caller.id)
      email = null
    } else if (!userId && !email) {
      return NextResponse.json(
        { success: false, message: 'User ID or email is required' },
        { status: 400 }
      )
    }

    let sql = `
      SELECT 
        b.*,
        s.name as service_name,
        s.slug as service_slug,
        s.image_url as service_image,
        s.duration_minutes,
        c.name as category_name,
        c.slug as category_slug,
        sp.name as provider_name,
        sp.rating as provider_rating,
        (SELECT COUNT(*) FROM provider_reviews pr WHERE pr.booking_id = b.id) as has_review,
        (SELECT i.status FROM invoices i WHERE i.booking_id = b.id LIMIT 1) as invoice_status
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN service_categories c ON s.category_id = c.id
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      WHERE 1=1
    `
    const params = []

    if (userId) {
      sql += ' AND b.user_id = ?'
      params.push(userId)
    } else if (email) {
      sql += ' AND b.customer_email = ?'
      params.push(email)
    }

    sql += ' ORDER BY b.created_at DESC'

    const bookings = await execute(sql, params)

    // Get photos and calculate proper amounts
    for (let booking of bookings) {
      const photos = await execute(
        'SELECT photo_url FROM booking_photos WHERE booking_id = ?',
        [booking.id]
      )
      booking.photos = photos.map(p => p.photo_url)

      // Get status history
      const statusHistory = await execute(
        `SELECT * FROM booking_status_history 
         WHERE booking_id = ? 
         ORDER BY created_at DESC`,
        [booking.id]
      )
      booking.status_history = statusHistory

      // Calculate amounts properly
      const basePrice = parseFloat(booking.service_price || 0)
      const additionalPrice = parseFloat(booking.additional_price || 0)
      const overtimeEarnings = parseFloat(booking.overtime_earnings || 0)
      const finalAmount = parseFloat(booking.final_provider_amount || booking.provider_amount || 0)

      booking.display = {
        base_price: basePrice,
        additional_price: additionalPrice,
        overtime_earnings: overtimeEarnings,
        customer_total: basePrice,
        provider_gets: finalAmount,
        has_overtime: overtimeEarnings > 0,
        overtime_minutes: booking.overtime_minutes || 0,
        overtime_rate: additionalPrice
      }

      booking.can_review = (booking.status === 'completed' && booking.invoice_status === 'paid' && booking.has_review === 0);
    }

    return NextResponse.json({ success: true, data: bookings })
  } catch (error) {
    console.error('Error fetching customer bookings:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch bookings' },
      { status: 500 }
    )
  }
}

// GET single booking details
export async function POST(request) {
  const auth = await requireCaller(request, ['customer', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const body = await request.json()
    const { booking_id, user_id, email } = body

    if (!booking_id) {
      return NextResponse.json(
        { success: false, message: 'Booking ID is required' },
        { status: 400 }
      )
    }

    // A customer may not name another account in the body.
    if (caller.role === 'customer' && namesAnotherAccount(caller, user_id, email)) return forbidden()

    let sql = `
      SELECT 
        b.*,
        s.name as service_name,
        s.slug as service_slug,
        s.image_url as service_image,
        s.description as service_description,
        s.duration_minutes,
        c.name as category_name,
        c.slug as category_slug,
        sp.name as provider_name,
        sp.rating as provider_rating,
        sp.phone as provider_phone,
        sp.email as provider_email
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN service_categories c ON s.category_id = c.id
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      WHERE b.id = ?
    `
    const params = [booking_id]

    if (caller.role === 'customer') {
      // Ownership comes from the caller, never from the body.
      sql += ' AND b.user_id = ?'
      params.push(caller.id)
    } else if (user_id) {
      sql += ' AND b.user_id = ?'
      params.push(user_id)
    } else if (email) {
      sql += ' AND b.customer_email = ?'
      params.push(email)
    } else {
      return NextResponse.json(
        { success: false, message: 'User ID or email required for verification' },
        { status: 400 }
      )
    }

    const bookings = await execute(sql, params)

    if (bookings.length === 0) {
      // A booking that exists but is not the customer's own is a 403, never the 404 below; one that does not exist keeps the 404.
      if (caller.role === 'customer') {
        const [existing] = await execute('SELECT id FROM bookings WHERE id = ?', [booking_id])
        if (existing) return forbidden()
      }
      return NextResponse.json(
        { success: false, message: 'Booking not found or unauthorized' },
        { status: 404 }
      )
    }

    const booking = bookings[0]

    const photos = await execute(
      'SELECT photo_url FROM booking_photos WHERE booking_id = ?',
      [booking_id]
    )
    booking.photos = photos.map(p => p.photo_url)

    // Fetch provider-uploaded job photos (before/after)
    const jobPhotos = await execute(
      `SELECT photo_url, photo_type FROM job_photos WHERE booking_id = ? ORDER BY photo_type, uploaded_at`,
      [booking_id]
    )
    booking.before_photos = jobPhotos.filter(p => p.photo_type === 'before')
    booking.after_photos = jobPhotos.filter(p => p.photo_type === 'after')

    const statusHistory = await execute(
      `SELECT * FROM booking_status_history 
       WHERE booking_id = ? 
       ORDER BY created_at DESC`,
      [booking_id]
    )
    booking.status_history = statusHistory

    const basePrice = parseFloat(booking.service_price || 0)
    const additionalPrice = parseFloat(booking.additional_price || 0)
    const overtimeEarnings = parseFloat(booking.overtime_earnings || 0)
    const finalAmount = parseFloat(booking.final_provider_amount || booking.provider_amount || 0)

    booking.display = {
      base_price: basePrice,
      additional_price: additionalPrice,
      overtime_earnings: overtimeEarnings,
      customer_total: basePrice,
      provider_gets: finalAmount,
      has_overtime: overtimeEarnings > 0,
      overtime_minutes: booking.overtime_minutes || 0,
      overtime_rate: additionalPrice,
      standard_duration: booking.duration_minutes || 60,
      actual_duration: booking.actual_duration_minutes || 0
    }

    return NextResponse.json({ success: true, data: booking })
  } catch (error) {
    console.error('Error fetching booking details:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch booking details' },
      { status: 500 }
    )
  }
}






