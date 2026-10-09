


// app/api/provider/route.js - OPTIONAL IMPROVEMENT
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'  // ✅ CHANGE: query → execute
import { requireCaller } from '@/lib/api-auth'

// GET
export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const status = searchParams.get('status')

    if (id) {
      // ✅ Using execute()
      const rows = await execute(
        `SELECT id, name, email, phone, specialty, experience_years,
                rating, total_jobs, bio, avatar_url, location, city, status, created_at
         FROM service_providers WHERE id = ?`,
        [id]
      )
      if (rows.length === 0) return NextResponse.json({ success: false, message: 'Provider not found' }, { status: 404 })
      return NextResponse.json({ success: true, data: rows[0] })
    }

    let sql = `
      SELECT id, name, email, phone, specialty, experience_years,
             rating, total_jobs, bio, avatar_url, location, city, status, created_at
      FROM service_providers
    `
    const params = []
    if (status) {
      sql += ` WHERE status = ?`
      params.push(status)
    }
    sql += ` ORDER BY name ASC`

    // ✅ Using execute()
    const providers = await execute(sql, params)
    return NextResponse.json({ success: true, data: providers, total: providers.length })

  } catch (error) {
    console.error('Error fetching providers:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch providers' }, { status: 500 })
  }
}

// PUT
export async function PUT(request) {
  const auth = await requireCaller(request, ['admin', 'provider']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    // The ?id= branches edit any provider: admin only. The branch without ?id= is the signed-in provider's own
    // profile: provider only (an admin has no profile to update). Decided before the body is read.
    if (id ? auth.caller.role !== 'admin' : auth.caller.role !== 'provider') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()

    // Admin: status update or full provider edit
    if (id) {
      // if only status provided, treat as status change
      if (body.status && Object.keys(body).length === 1) {
        const { status } = body
        const allowed = ['active', 'inactive', 'suspended', 'pending', 'rejected']
        if (!status || !allowed.includes(status)) {
          return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 })
        }
        await execute(`UPDATE service_providers SET status = ?, updated_at = NOW() WHERE id = ?`, [status, id])
        return NextResponse.json({ success: true, message: 'Status updated' })
      }
      // otherwise admin is updating provider profile fields
      const { name, email, phone, password, specialty, city, rating, total_jobs, bio, location } = body
      if (!name || !email || !phone) {
        return NextResponse.json({ success: false, message: 'Name, email and phone are required' }, { status: 400 })
      }
      // prevent duplicate email
      const existing = await execute(
        'SELECT id FROM service_providers WHERE email = ? AND id != ?',
        [email, id]
      )
      if (existing.length > 0) {
        return NextResponse.json({ success: false, message: 'Email already in use' }, { status: 400 })
      }

      let hashedPassword = null
      if (password) {
        const bcrypt = await import('bcryptjs')
        hashedPassword = await bcrypt.hash(password, 10)
      }
      if (hashedPassword) {
        await execute(
          `UPDATE service_providers SET
             name = ?, email = ?, phone = ?, password = ?, specialty = ?,
             city = ?, rating = COALESCE(?, rating),
             total_jobs = COALESCE(?, total_jobs),
             bio = ?, location = ?, updated_at = NOW()
           WHERE id = ?`,
          [name, email, phone, hashedPassword, specialty || null, city || null,
            rating != null ? parseFloat(rating) : null,
            total_jobs != null ? parseInt(total_jobs) : null,
            bio || null, location || null, id]
        )
      } else {
        await execute(
          `UPDATE service_providers SET
             name = ?, email = ?, phone = ?, specialty = ?,
             city = ?, rating = COALESCE(?, rating),
             total_jobs = COALESCE(?, total_jobs),
             bio = ?, location = ?, updated_at = NOW()
           WHERE id = ?`,
          [name, email, phone, specialty || null, city || null,
            rating != null ? parseFloat(rating) : null,
            total_jobs != null ? parseInt(total_jobs) : null,
            bio || null, location || null, id]
        )
      }
      return NextResponse.json({ success: true, message: 'Provider updated' })
    }

    // Provider: own profile update (the id is the signed-in provider's, never a query or body value)
    const { name, email, phone, specialty, experience_years, bio, location, city, service_cities, avatar_url } = body

    if (!name || !email || !phone) {
      return NextResponse.json({ success: false, message: 'Name, email and phone are required' }, { status: 400 })
    }

    // ✅ Using execute()
    const existing = await execute(
      'SELECT id FROM service_providers WHERE email = ? AND id != ?',
      [email, auth.caller.id]
    )
    if (existing.length > 0) {
      return NextResponse.json({ success: false, message: 'Email already in use' }, { status: 400 })
    }

    // ✅ Using execute()
    await execute(
      `UPDATE service_providers SET
        name = ?, email = ?, phone = ?, specialty = ?,
        experience_years = ?, bio = ?, location = ?, city = ?, service_cities = ?,
        avatar_url = COALESCE(?, avatar_url), updated_at = NOW()
       WHERE id = ?`,
      [name, email, phone, specialty || null,
        experience_years ? parseInt(experience_years) : null,
        bio || null, location || null, city || null, 
        Array.isArray(service_cities) ? JSON.stringify(service_cities) : null,
        avatar_url || null, auth.caller.id]
    )

    // ✅ Using execute()
    const updated = await execute(
      `SELECT id, name, email, phone, specialty, experience_years,
              rating, total_jobs, bio, avatar_url, location, city, status, service_cities
       FROM service_providers WHERE id = ?`,
      [auth.caller.id]
    )

    return NextResponse.json({ success: true, message: 'Profile updated successfully', data: updated[0] })

  } catch (error) {
    console.error('Error updating provider:', error)
    return NextResponse.json({ success: false, message: 'Failed to update provider' }, { status: 500 })
  }
}

// DELETE
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

    // verify provider exists
    const [provRows] = await connection.execute(
      'SELECT id FROM service_providers WHERE id = ?',
      [id]
    )
    if (provRows.length === 0) {
      await connection.rollback()
      return NextResponse.json({ success: false, message: 'Provider not found' }, { status: 404 })
    }

    // find bookings for this provider
    const [bookingRows] = await connection.execute(
      'SELECT id FROM bookings WHERE provider_id = ?',
      [id]
    )
    const bookingIds = bookingRows.map(b => b.id)

    if (bookingIds.length > 0) {
      const placeholders = bookingIds.map(() => '?').join(',')

      await connection.execute(
        `DELETE FROM chat_messages WHERE booking_id IN (${placeholders})`,
        bookingIds
      )
      await connection.execute(
        `DELETE FROM booking_photos WHERE booking_id IN (${placeholders})`,
        bookingIds
      )
      await connection.execute(
        `DELETE FROM booking_status_history WHERE booking_id IN (${placeholders})`,
        bookingIds
      )
      await connection.execute(
        `DELETE FROM booking_time_logs WHERE booking_id IN (${placeholders})`,
        bookingIds
      )
      await connection.execute(
        `DELETE FROM job_photos WHERE booking_id IN (${placeholders})`,
        bookingIds
      )
      await connection.execute(
        `DELETE FROM invoices WHERE booking_id IN (${placeholders})`,
        bookingIds
      )
      await connection.execute(
        `DELETE FROM provider_reviews WHERE booking_id IN (${placeholders})`,
        bookingIds
      )

      await connection.execute(
        `DELETE FROM bookings WHERE id IN (${placeholders})`,
        bookingIds
      )
    }

    // remove any remaining reviews or invoices tied to provider
    await connection.execute(
      `DELETE FROM provider_reviews WHERE provider_id = ?`,
      [id]
    )
    await connection.execute(
      `DELETE FROM invoices WHERE provider_id = ?`,
      [id]
    )

    await connection.execute(
      `DELETE FROM provider_documents WHERE provider_id = ?`,
      [id]
    )
    await connection.execute(
      `DELETE FROM provider_bank_accounts WHERE provider_id = ?`,
      [id]
    )
    await connection.execute(
      `DELETE FROM mobile_auth_users WHERE provider_id = ?`,
      [id]
    )

    // finally delete provider
    const [provResult] = await connection.execute(
      'DELETE FROM service_providers WHERE id = ?',
      [id]
    )

    await connection.commit()

    return NextResponse.json({
      success: true,
      message: 'Provider and all associated data deleted successfully',
      deleted: { provider: provResult.affectedRows }
    })

  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error deleting provider:', error)
    return NextResponse.json({ success: false, message: 'Failed to delete provider' }, { status: 500 })
  } finally {
    if (connection) connection.release()
  }
}