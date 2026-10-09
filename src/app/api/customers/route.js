// app/api/customers/route.js - FIXED
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')

    if (email) {
      console.log('Fetching bookings for email:', email)
      const bookings = await execute(
        `SELECT b.*, c.name as category_name
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         LEFT JOIN service_categories c ON s.category_id = c.id
         WHERE b.customer_email = ?
         ORDER BY b.created_at DESC`,
        [email]
      )
      return NextResponse.json({ success: true, data: bookings })
    }

    const users = await execute(
      `SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.hear_about,
        u.receive_offers,
        u.role,
        u.created_at,
        COUNT(b.id) as booking_count
       FROM users u
       LEFT JOIN bookings b ON b.customer_email = u.email
       GROUP BY u.id
       ORDER BY u.role ASC, u.created_at DESC`
    )

    return NextResponse.json({ success: true, data: users, total: users.length })

  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { first_name, last_name, email, phone, password, role } = await request.json()

    if (!first_name || !last_name || !email || !password) {
      console.log('POST /api/customers 400: Missing fields', { first_name, last_name, email, hasPassword: !!password })
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 })
    }

    // Check if email already exists in either table
    const [existingUser, existingProvider] = await Promise.all([
      execute('SELECT id FROM users WHERE email = ?', [email]),
      execute('SELECT id FROM service_providers WHERE email = ?', [email])
    ])

    if (existingUser.length > 0 || existingProvider.length > 0) {
      console.log('POST /api/customers 400: Email already registered', email)
      return NextResponse.json({ success: false, message: 'Email already registered' }, { status: 400 })
    }

    // Hash password
    const bcrypt = await import('bcryptjs')
    const hashedPassword = await bcrypt.hash(password, 10)

    if (role === 'provider') {
      // Insert into service_providers
      await execute(
        `INSERT INTO service_providers (name, email, password, phone, status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
        [`${first_name} ${last_name}`, email, hashedPassword, phone || null]
      )
    } else {
      // Insert into users
      await execute(
        `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [first_name, last_name, email, phone || null, hashedPassword, role || 'user']
      )
    }

    return NextResponse.json({ success: true, message: `${role === 'provider' ? 'Provider' : 'User'} created successfully` })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json({ success: false, message: 'Failed to create user' }, { status: 500 })
  }
}

export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      console.log('PUT /api/customers 400: ID required')
      return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 })
    }

    const { first_name, last_name, phone, password, receive_offers, role } = await request.json()

    let hashedPassword = null
    if (password) {
      const bcrypt = await import('bcryptjs')
      hashedPassword = await bcrypt.hash(password, 10)
    }

    if (role === 'provider') {
      if (hashedPassword) {
        await execute(
          `UPDATE service_providers SET name = ?, phone = ?, password = ?, updated_at = NOW() WHERE id = ?`,
          [`${first_name} ${last_name}`, phone || null, hashedPassword, id]
        )
      } else {
        await execute(
          `UPDATE service_providers SET name = ?, phone = ?, updated_at = NOW() WHERE id = ?`,
          [`${first_name} ${last_name}`, phone || null, id]
        )
      }
    } else {
      if (hashedPassword) {
        await execute(
          `UPDATE users SET first_name = ?, last_name = ?, phone = ?, password_hash = ?, receive_offers = ?, updated_at = NOW() WHERE id = ?`,
          [first_name, last_name, phone || null, hashedPassword, receive_offers ? 1 : 0, id]
        )
      } else {
        await execute(
          `UPDATE users SET first_name = ?, last_name = ?, phone = ?, receive_offers = ?, updated_at = NOW() WHERE id = ?`,
          [first_name, last_name, phone || null, receive_offers ? 1 : 0, id]
        )
      }
    }

    return NextResponse.json({ success: true, message: 'User updated successfully' })
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json({ success: false, message: 'Failed to update user' }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  const { getConnection } = await import('@/lib/db')
  let connection
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 })

    connection = await getConnection()
    await connection.beginTransaction()

    try {
      // 1. Get user info (email needed to find bookings by customer_email)
      const [userRows] = await connection.execute(
        `SELECT id, email, role FROM users WHERE id = ?`, [id]
      )
      if (userRows.length === 0) {
        await connection.rollback()
        return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
      }
      const user = userRows[0]
      const userEmail = user.email

      // 2. Get all booking IDs for this user (by user_id OR customer_email)
      const [bookingRows] = await connection.execute(
        `SELECT id FROM bookings WHERE user_id = ? OR customer_email = ?`,
        [id, userEmail]
      )
      const bookingIds = bookingRows.map(b => b.id)

      let deletedBookings = 0
      if (bookingIds.length > 0) {
        // 3. Delete booking child records (these also cascade but let's be explicit)
        //    chat_messages, booking_photos, booking_status_history, booking_time_logs, job_photos
        //    all have ON DELETE CASCADE from bookings, but we delete bookings explicitly
        const placeholders = bookingIds.map(() => '?').join(',')

        await connection.execute(
          `DELETE FROM chat_messages WHERE booking_id IN (${placeholders})`, bookingIds
        )
        await connection.execute(
          `DELETE FROM booking_photos WHERE booking_id IN (${placeholders})`, bookingIds
        )
        await connection.execute(
          `DELETE FROM booking_status_history WHERE booking_id IN (${placeholders})`, bookingIds
        )
        await connection.execute(
          `DELETE FROM booking_time_logs WHERE booking_id IN (${placeholders})`, bookingIds
        )
        await connection.execute(
          `DELETE FROM job_photos WHERE booking_id IN (${placeholders})`, bookingIds
        )

        // 4. Delete invoices linked to these bookings
        await connection.execute(
          `DELETE FROM invoices WHERE booking_id IN (${placeholders})`, bookingIds
        )

        // 5. Delete provider_reviews linked to these bookings
        await connection.execute(
          `DELETE FROM provider_reviews WHERE booking_id IN (${placeholders})`, bookingIds
        )

        // 6. Delete the bookings themselves
        const [bookingResult] = await connection.execute(
          `DELETE FROM bookings WHERE id IN (${placeholders})`, bookingIds
        )
        deletedBookings = bookingResult.affectedRows
      }

      // 7. Delete any remaining provider_reviews by customer_id (in case of orphaned reviews)
      await connection.execute(
        `DELETE FROM provider_reviews WHERE customer_id = ?`, [id]
      )

      // 8. Delete any remaining invoices by user_id
      await connection.execute(
        `DELETE FROM invoices WHERE user_id = ?`, [id]
      )

      // 8.5 Delete mobile auth sessions
      await connection.execute(
        `DELETE FROM mobile_auth_users WHERE user_id = ?`, [id]
      )

      // 9. Finally delete the user
      const [userResult] = await connection.execute(
        `DELETE FROM users WHERE id = ?`, [id]
      )

      await connection.commit()

      return NextResponse.json({
        success: true,
        message: `User and all associated data deleted successfully`,
        deleted: {
          user: userResult.affectedRows,
          bookings: deletedBookings
        }
      })

    } catch (innerError) {
      await connection.rollback()
      throw innerError
    }

  } catch (error) {
    console.error('Error deleting user (cascade):', error)
    return NextResponse.json({ success: false, message: 'Failed to delete user: ' + error.message }, { status: 500 })
  } finally {
    if (connection) connection.release()
  }
}