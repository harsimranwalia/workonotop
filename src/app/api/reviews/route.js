// import { NextResponse } from 'next/server'
// import { query } from '@/lib/db'

// // GET all reviews
// export async function GET(request) {
//   try {
//     const { searchParams } = new URL(request.url)
//     const providerId = searchParams.get('provider_id')
//     const rating = searchParams.get('rating')

//     let sql = `
//       SELECT 
//         r.*,
//         c.first_name, c.last_name, c.email as customer_email,
//         CONCAT(c.first_name, ' ', c.last_name) as customer_name,
//         p.name as provider_name,
//         s.name as service_name,
//         b.booking_date
//       FROM reviews r
//       LEFT JOIN customers c ON r.customer_id = c.id
//       LEFT JOIN service_providers p ON r.provider_id = p.id
//       LEFT JOIN bookings b ON r.booking_id = b.id
//       LEFT JOIN services s ON b.service_id = s.id
//       WHERE 1=1
//     `
//     const params = []

//     if (providerId) {
//       sql += ' AND r.provider_id = ?'
//       params.push(providerId)
//     }

//     if (rating) {
//       sql += ' AND r.rating = ?'
//       params.push(rating)
//     }

//     sql += ' ORDER BY r.created_at DESC'

//     const reviews = await query(sql, params)

//     return NextResponse.json({ 
//       success: true, 
//       data: reviews 
//     })
//   } catch (error) {
//     console.error('Error fetching reviews:', error)
//     return NextResponse.json(
//       { success: false, message: 'Failed to fetch reviews' },
//       { status: 500 }
//     )
//   }
// }

// // DELETE review
// export async function DELETE(request) {
//   try {
//     const { searchParams } = new URL(request.url)
//     const id = searchParams.get('id')

//     if (!id) {
//       return NextResponse.json(
//         { success: false, message: 'ID is required' },
//         { status: 400 }
//       )
//     }

//     await query('DELETE FROM reviews WHERE id = ?', [id])
//     return NextResponse.json({ success: true, message: 'Review deleted' })
//   } catch (error) {
//     console.error('Error deleting review:', error)
//     return NextResponse.json(
//       { success: false, message: 'Failed to delete review' },
//       { status: 500 }
//     )
//   }
// }



















import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

// GET all reviews
export async function GET(request) {
  const auth = await requireCaller(request, ['customer', 'admin']);
  if (!auth.ok) return auth.response;
  const isCustomer = auth.caller.role === 'customer'
  try {
    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get('provider_id')
    const bookingId = searchParams.get('booking_id')
    const customerId = searchParams.get('customer_id')
    const rating = searchParams.get('rating')

    // A customer may name only themselves in customer_id (anyone else is a 403); an admin may name anyone.
    if (isCustomer && customerId && String(customerId) !== String(auth.caller.id)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }

    let sql = `
      SELECT 
        r.*,
        u.first_name, u.last_name, u.email as customer_email,
        CONCAT(u.first_name, ' ', u.last_name) as customer_name,
        p.name as provider_name,
        s.name as service_name,
        b.booking_number,
        b.job_date
      FROM provider_reviews r
      LEFT JOIN users u ON r.customer_id = u.id
      LEFT JOIN service_providers p ON r.provider_id = p.id
      LEFT JOIN bookings b ON r.booking_id = b.id
      LEFT JOIN services s ON b.service_id = s.id
      WHERE 1=1
    `
    const params = []

    // A customer sees only the reviews of their own bookings (the booking's user_id is the caller); an admin sees all.
    if (isCustomer) {
      sql += ' AND b.user_id = ?'
      params.push(auth.caller.id)
    }

    if (providerId) {
      sql += ' AND r.provider_id = ?'
      params.push(providerId)
    }

    if (bookingId) {
      sql += ' AND r.booking_id = ?'
      params.push(bookingId)
    }

    if (customerId) {
      sql += ' AND r.customer_id = ?'
      params.push(customerId)
    }

    if (rating) {
      sql += ' AND r.rating = ?'
      params.push(rating)
    }

    sql += ' ORDER BY r.created_at DESC'

    console.log('Executing SQL:', sql)
    console.log('With params:', params)

    const reviews = await query(sql, params)

    return NextResponse.json({
      success: true,
      data: reviews
    })
  } catch (error) {
    console.error('Error fetching reviews:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch reviews', error: error.message },
      { status: 500 }
    )
  }
}

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })

// POST - Create a new review
export async function POST(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const body = await request.json()
    const {
      booking_id,
      provider_id,
      customer_id,
      rating,
      review,
      is_anonymous
    } = body

    console.log('Received review data:', body)

    // Validate required fields
    if (!booking_id || !provider_id || !customer_id || !rating) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { success: false, message: 'Rating must be between 1 and 5' },
        { status: 400 }
      )
    }

    // A customer reviews as themselves: a customer_id naming anyone else is a 403 and is never stored (the caller's id is).
    if (String(customer_id) !== String(caller.id)) return forbidden()

    // Check if booking exists and is completed
    const [booking] = await query(
      `SELECT status, user_id, provider_id FROM bookings WHERE id = ?`,
      [booking_id]
    )

    if (!booking) {
      return NextResponse.json(
        { success: false, message: 'Booking not found' },
        { status: 404 }
      )
    }

    // The booking must be the caller's own (bookings.user_id), and the provider reviewed is the booking's own: another
    // account's booking, or a provider_id naming anyone else, is a 403, decided before the status check below.
    if (String(booking.user_id) !== String(caller.id)) return forbidden()
    if (String(provider_id) !== String(booking.provider_id)) return forbidden()

    if (booking.status !== 'completed') {
      return NextResponse.json(
        { success: false, message: 'Can only review completed bookings' },
        { status: 400 }
      )
    }

    // Check if review already exists
    const [existingReview] = await query(
      `SELECT id FROM provider_reviews WHERE booking_id = ?`,
      [booking_id]
    )

    if (existingReview) {
      return NextResponse.json(
        { success: false, message: 'Review already exists for this booking' },
        { status: 400 }
      )
    }

    // Insert review
    const result = await query(
      `INSERT INTO provider_reviews 
       (booking_id, provider_id, customer_id, rating, review, is_anonymous, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [booking_id, booking.provider_id, caller.id, rating, review || null, is_anonymous || 0]
    )

    // Update provider's average rating
    await updateProviderRating(booking.provider_id)

    return NextResponse.json({
      success: true,
      message: 'Review submitted successfully',
      review_id: result.insertId
    })

  } catch (error) {
    console.error('Error creating review:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to submit review', error: error.message },
      { status: 500 }
    )
  }
}

// DELETE review
export async function DELETE(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'ID is required' },
        { status: 400 }
      )
    }

    // Get provider_id before deleting
    const [review] = await query('SELECT provider_id FROM provider_reviews WHERE id = ?', [id])

    if (review) {
      await query('DELETE FROM provider_reviews WHERE id = ?', [id])
      // Update provider's average rating after deletion
      await updateProviderRating(review.provider_id)
    }

    return NextResponse.json({ success: true, message: 'Review deleted' })
  } catch (error) {
    console.error('Error deleting review:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete review' },
      { status: 500 }
    )
  }
}

// Helper function to update provider's average rating
async function updateProviderRating(providerId) {
  try {
    // Calculate new average rating
    const [result] = await query(
      `SELECT 
        AVG(rating) as avg_rating,
        COUNT(*) as total_reviews
       FROM provider_reviews 
       WHERE provider_id = ?`,
      [providerId]
    )

    // Update provider table
    await query(
      `UPDATE service_providers 
       SET avg_rating = ?, total_reviews = ?
       WHERE id = ?`,
      [result.avg_rating || 0, result.total_reviews || 0, providerId]
    )

    return true
  } catch (error) {
    console.error('Error updating provider rating:', error)
    return false
  }
}