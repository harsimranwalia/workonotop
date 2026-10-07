// // app/api/provider/ratings/route.js
// import { NextResponse } from 'next/server'
// import { getConnection } from '@/lib/db'
// import jwt from 'jsonwebtoken'


// // GET provider's ratings and reviews
// export async function GET(request) {
//   let connection
//   try {
//     const { searchParams } = new URL(request.url)
//     const provider_id = searchParams.get('provider_id')
//     const token = request.headers.get('Authorization')?.split(' ')[1]

//     if (!token) {
//       return NextResponse.json(
//         { success: false, message: 'Unauthorized' },
//         { status: 401 }
//       )
//     }

//     // Verify token
//     let decoded
//     try {
//       decoded = jwt.verify(token, JWT_SECRET)
//     } catch {
//       return NextResponse.json(
//         { success: false, message: 'Invalid token' },
//         { status: 401 }
//       )
//     }

//     const targetProviderId = provider_id || decoded.id

//     connection = await getConnection()
//     try {
//       // Get provider's rating stats
//       const [stats] = await connection.execute(
//         `SELECT 
//           sp.rating,
//           sp.total_reviews,
//           sp.avg_rating,
//           (SELECT COUNT(*) FROM provider_reviews WHERE provider_id = ?) as review_count,
//           (SELECT AVG(rating) FROM provider_reviews WHERE provider_id = ?) as average_rating
//         FROM service_providers sp
//         WHERE sp.id = ?`,
//         [targetProviderId, targetProviderId, targetProviderId]
//       )

//       // Get all reviews with customer details
//       const [reviews] = await connection.execute(
//         `SELECT 
//           pr.*,
//           u.first_name,
//           u.last_name,
//           b.service_name,
//           b.job_date,
//           DATE_FORMAT(pr.created_at, '%Y-%m-%d') as review_date
//         FROM provider_reviews pr
//         JOIN users u ON pr.customer_id = u.id
//         JOIN bookings b ON pr.booking_id = b.id
//         WHERE pr.provider_id = ?
//         ORDER BY pr.created_at DESC`,
//         [targetProviderId]
//       )

//       // Calculate rating distribution
//       const distribution = {
//         5: reviews.filter(r => r.rating === 5).length,
//         4: reviews.filter(r => r.rating === 4).length,
//         3: reviews.filter(r => r.rating === 3).length,
//         2: reviews.filter(r => r.rating === 2).length,
//         1: reviews.filter(r => r.rating === 1).length
//       }

//       return NextResponse.json({
//         success: true,
//         data: {
//           stats: {
//             overall_rating: stats[0]?.avg_rating || stats[0]?.rating || 0,
//             total_reviews: stats[0]?.total_reviews || reviews.length,
//             average_rating: stats[0]?.avg_rating || 0,
//             distribution
//           },
//           reviews: reviews.map(r => ({
//             id: r.id,
//             rating: r.rating,
//             review: r.review,
//             customer_name: r.is_anonymous ? 'Anonymous' : `${r.first_name} ${r.last_name}`,
//             service: r.service_name,
//             date: r.review_date,
//             is_anonymous: r.is_anonymous
//           }))
//         }
//       })
//     } finally {
//       if (connection) connection.release()
//     }
//   } catch (error) {
//     console.error('Error fetching ratings:', error)
//     return NextResponse.json(
//       { success: false, message: 'Failed to fetch ratings' },
//       { status: 500 })
//   }
//   }





// src/app/api/provider/ratings/route.js
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    // A provider may name only themselves: a provider_id in the query that is not the caller's own id (compared as
    // strings) is a 403, never a 404. No parameter, or an empty one, means the caller's own ratings. The route still
    // reads only the caller's rows: both queries below bind providerId, which is caller.id and nothing from the request.
    if (new URL(request.url).searchParams.getAll('provider_id').some((id) => id !== '' && id !== String(caller.id))) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }

    const providerId = caller.id

    // Get provider rating stats
    const stats = await execute(
      `SELECT 
        avg_rating,
        total_reviews
       FROM service_providers 
       WHERE id = ?`,
      [providerId]
    )

    // Get all reviews with customer + service details
    const reviews = await execute(
      `SELECT 
        pr.id,
        pr.rating,
        pr.review,
        pr.is_anonymous,
        pr.created_at,
        u.first_name,
        u.last_name,
        b.service_name,
        DATE_FORMAT(pr.created_at, '%Y-%m-%d') as review_date
       FROM provider_reviews pr
       LEFT JOIN users u ON pr.customer_id = u.id
       LEFT JOIN bookings b ON pr.booking_id = b.id
       WHERE pr.provider_id = ?
       ORDER BY pr.created_at DESC`,
      [providerId]
    )

    // Rating distribution
    const distribution = {
      5: reviews.filter(r => r.rating === 5).length,
      4: reviews.filter(r => r.rating === 4).length,
      3: reviews.filter(r => r.rating === 3).length,
      2: reviews.filter(r => r.rating === 2).length,
      1: reviews.filter(r => r.rating === 1).length,
    }

    const provider = stats[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          average_rating: parseFloat(provider.avg_rating || 0),
          total_reviews: parseInt(provider.total_reviews || reviews.length),
          distribution,
        },
        reviews: reviews.map(r => ({
          id: r.id,
          rating: r.rating,
          review: r.review,
          customer_name: r.is_anonymous ? 'Anonymous' : (r.first_name ? `${r.first_name} ${r.last_name}` : 'Unknown Customer'),
          service: r.service_name || 'General Service',
          date: r.review_date,
          is_anonymous: r.is_anonymous,
        })),
      },
    })

  } catch (error) {
    console.error('Ratings error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to load ratings' },
      { status: 500 }
    )
  }
}