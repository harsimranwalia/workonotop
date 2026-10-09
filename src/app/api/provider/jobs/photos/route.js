// app/api/provider/jobs/photos/route.js - FIXED with cookie auth
import { NextResponse } from 'next/server'
import { execute, getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import exifr from 'exifr'
import path from 'path'
import { readFile } from 'fs/promises'

// POST: Upload photo record
export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  let connection
  try {
    const { booking_id, photo_url, photo_type } = await request.json()

    if (!booking_id || !photo_url || !photo_type) {
      return NextResponse.json({ 
        success: false, 
        message: 'Missing required fields' 
      }, { status: 400 })
    }

    if (!['before', 'after'].includes(photo_type)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Invalid photo type' 
      }, { status: 400 })
    }

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      // Ownership: the booking must be the caller's own (provider_id = caller.id). The query filters by owner, so a
      // booking that is another provider's and one that does not exist both answer the route's existing 404 below.
      const [[booking]] = await connection.execute(
        `SELECT id FROM bookings WHERE id = ? AND provider_id = ?`,
        [booking_id, caller.id]
      )

      if (!booking) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ 
          success: false, 
          message: 'Booking not found or not assigned to you' 
        }, { status: 404 })
      }

      // Extract EXIF data
      let capturedAt = null;
      try {
        if (photo_url.startsWith('/uploads/')) {
          const filename = photo_url.split('/').pop();
          const filepath = path.join(process.cwd(), 'public/uploads', filename);
          const buffer = await readFile(filepath);
          const exifData = await exifr.parse(buffer, ['DateTimeOriginal']);
          if (exifData && exifData.DateTimeOriginal) {
            capturedAt = exifData.DateTimeOriginal;
          }
        }
      } catch (exifErr) {
        console.error('EXIF extraction failed:', exifErr);
      }

      // Insert photo
      await connection.execute(
        `INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by, captured_at)
         VALUES (?, ?, ?, ?, ?)`,
        [booking_id, photo_url, photo_type, caller.id, capturedAt]
      )

      // Update booking photo status
      if (photo_type === 'before') {
        await connection.execute(
          `UPDATE bookings SET before_photos_uploaded = TRUE WHERE id = ?`,
          [booking_id]
        )
      } else {
        await connection.execute(
          `UPDATE bookings SET after_photos_uploaded = TRUE WHERE id = ?`,
          [booking_id]
        )
      }

      await connection.query('COMMIT')

      return NextResponse.json({
        success: true,
        message: 'Photo uploaded successfully'
      })

    } catch (err) {
      await connection.query('ROLLBACK')
      throw err
    } finally {
      if (connection) connection.release()
    }

  } catch (error) {
    console.error('Error saving photo:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to save photo' 
    }, { status: 500 })
  }
}

// GET: Get photos for a booking
export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { searchParams } = new URL(request.url)
    const booking_id = searchParams.get('booking_id')

    if (!booking_id) {
      return NextResponse.json({ 
        success: false, 
        message: 'booking_id required' 
      }, { status: 400 })
    }

    // Ownership: the booking must be the caller's own (provider_id = caller.id). The query filters by owner, so a
    // booking that is another provider's and one that does not exist both answer the route's existing 404 below.
    const booking = await execute(
      `SELECT id FROM bookings WHERE id = ? AND provider_id = ?`,
      [booking_id, caller.id]
    )

    if (booking.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'Booking not found or not assigned to you' 
      }, { status: 404 })
    }

    // Get photos
    const photos = await execute(
      `SELECT * FROM job_photos 
       WHERE booking_id = ? 
       ORDER BY photo_type, uploaded_at`,
      [booking_id]
    )

    const grouped = {
      before: photos.filter(p => p.photo_type === 'before'),
      after: photos.filter(p => p.photo_type === 'after')
    }

    return NextResponse.json({
      success: true,
      data: grouped
    })

  } catch (error) {
    console.error('Error fetching photos:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to fetch photos' 
    }, { status: 500 })
  }
}