// app/api/customer/reviews/route.js
import { NextResponse } from 'next/server'
import { getConnection } from '@/lib/db'
import { logActivity } from '@/lib/logger'
import { requireCaller } from '@/lib/api-auth'

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })

// POST - Submit a review
export async function POST(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  let connection
  try {
    const { booking_id, provider_id, customer_id, rating, review, is_anonymous } = await request.json()

    // Validation
    if (!booking_id || !provider_id || !customer_id || !rating) {
      return NextResponse.json({ 
        success: false, 
        message: 'Missing required fields' 
      }, { status: 400 })
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json({ 
        success: false, 
        message: 'Rating must be between 1 and 5' 
      }, { status: 400 })
    }

    // A customer reviews as themselves: a customer_id naming anyone else is a 403 and is never stored (the caller's id is).
    if (String(customer_id) !== String(caller.id)) return forbidden()

    connection = await getConnection()

    // The booking must be the caller's own (bookings.user_id), and the provider reviewed is the booking's own: another
    // account's booking, or a provider_id naming anyone else, is a 403. A booking that does not exist is left to the
    // payment check below, which answers it as it always has.
    const [[owned]] = await connection.execute('SELECT user_id, provider_id FROM bookings WHERE id = ?', [booking_id])
    if (owned) {
      if (String(owned.user_id) !== String(caller.id)) return forbidden()
      if (String(provider_id) !== String(owned.provider_id)) return forbidden()
    }

    await connection.query('START TRANSACTION')

    try {
      // Check if invoice is paid
      const [invoices] = await connection.execute(
        `SELECT i.id, i.status, b.provider_id, b.user_id 
         FROM invoices i
         JOIN bookings b ON i.booking_id = b.id
         WHERE i.booking_id = ? AND i.status = 'paid'`,
        [booking_id]
      )

      if (invoices.length === 0) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ 
          success: false, 
          message: 'Payment not completed. You can review after payment.' 
        }, { status: 400 })
      }

      // The review is written for the caller and for the booking's own provider, never for ids from the body.
      const bookingProviderId = invoices[0].provider_id

      // Check if already reviewed
      const [existing] = await connection.execute(
        'SELECT id FROM provider_reviews WHERE booking_id = ?',
        [booking_id]
      )

      if (existing.length > 0) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ 
          success: false, 
          message: 'You have already reviewed this provider' 
        }, { status: 400 })
      }

      // Insert review
      await connection.execute(
        `INSERT INTO provider_reviews 
         (booking_id, provider_id, customer_id, rating, review, is_anonymous)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [booking_id, bookingProviderId, caller.id, rating, review || null, is_anonymous || false]
      )

      // Update provider's average rating
      await connection.execute(
        `UPDATE service_providers sp
         SET 
           total_reviews = (
             SELECT COUNT(*) FROM provider_reviews WHERE provider_id = ?
           ),
           avg_rating = (
             SELECT COALESCE(AVG(rating), 0) 
             FROM provider_reviews 
             WHERE provider_id = ?
           )
         WHERE sp.id = ?`,
        [bookingProviderId, bookingProviderId, bookingProviderId]
      )

      await connection.query('COMMIT')

      // Log Activity
      logActivity({
        actor_id: caller.id,
        actor_type: 'customer',
        actor_name: `Customer #${caller.id}`, // customer name is not explicitly passed, fallback to ID
        action: 'REVIEW_SUBMITTED',
        entity_type: 'provider',
        entity_id: bookingProviderId,
        details: { booking_id, rating }
      })

      return NextResponse.json({
        success: true,
        message: 'Review submitted successfully',
        data: { rating, review }
      })

    } catch (err) {
      await connection.query('ROLLBACK')
      throw err
    }

  } catch (error) {
    console.error('Error submitting review:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to submit review: ' + error.message 
    }, { status: 500 })
  } finally {
    if (connection) connection.release()
  }
}

// GET - Check if customer can review
export async function GET(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { searchParams } = new URL(request.url)
    const booking_id = searchParams.get('booking_id')
    const customer_id = searchParams.get('customer_id')

    if (!booking_id || !customer_id) {
      return NextResponse.json({ 
        success: false, 
        message: 'Booking ID and Customer ID required' 
      }, { status: 400 })
    }

    // A customer_id naming anyone else is a 403; the query below uses the caller's id.
    if (String(customer_id) !== String(caller.id)) return forbidden()

    const { query } = await import('@/lib/db')

    // A booking that exists but is not the caller's own is a 403, never the 404 below; one that does not exist keeps the 404.
    const [booking] = await query('SELECT user_id FROM bookings WHERE id = ?', [booking_id])
    if (booking && String(booking.user_id) !== String(caller.id)) return forbidden()

    const results = await query(
      `SELECT 
        b.id,
        b.provider_id,
        b.status as booking_status,
        i.status as invoice_status,
        (SELECT id FROM provider_reviews WHERE booking_id = b.id) as review_id,
        (SELECT rating FROM provider_reviews WHERE booking_id = b.id) as existing_rating,
        (SELECT review FROM provider_reviews WHERE booking_id = b.id) as existing_review
       FROM bookings b
       JOIN invoices i ON b.id = i.booking_id
       WHERE b.id = ? AND b.user_id = ?`,
      [booking_id, caller.id]
    )

    if (results.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'Booking not found' 
      }, { status: 404 })
    }

    const data = results[0]
    const can_review = data.booking_status === 'completed' && 
                       data.invoice_status === 'paid' && 
                       !data.review_id

    return NextResponse.json({
      success: true,
      data: {
        can_review,
        booking_status: data.booking_status,
        invoice_status: data.invoice_status,
        has_reviewed: !!data.review_id,
        existing_review: data.review_id ? {
          rating: data.existing_rating,
          review: data.existing_review
        } : null,
        provider_id: data.provider_id
      }
    })

  } catch (error) {
    console.error('Error checking review status:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to check review status' 
    }, { status: 500 })
  }
}