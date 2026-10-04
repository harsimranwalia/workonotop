import { NextResponse } from 'next/server'
import { execute, query, getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { notifyUser } from '@/lib/push'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic';

// Helper to get system settings
async function getSystemSetting(key, defaultValue = null) {
  try {
    const results = await execute('SELECT `value` FROM system_settings WHERE `key` = ?', [key])
    return results && results.length > 0 ? results[0].value : defaultValue
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error)
    return defaultValue
  }
}

// ── GET: List available jobs ──────────────────────────────────────────────────
export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  let providerId = null;
  let locationFilter = '';
  let countOnly = false;

  try {
    providerId = auth.caller.id;

    // Fetch default commission once
    const defaultCommRaw = await getSystemSetting('default_commission', '20')
    const defaultComm = parseFloat(defaultCommRaw)

    const { searchParams } = new URL(request.url)
    const cityParam = searchParams.get('city')
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1)
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
    const offset = (page - 1) * limit
    countOnly = searchParams.get('count') === 'true'
    const previewLimit = parseInt(searchParams.get('preview') || '3')

    const providers = await execute('SELECT city, service_cities, service_areas FROM service_providers WHERE id = ?', [providerId])
    const providerCity = providers && providers.length > 0 ? (providers[0].city || '') : ''
    const providerServiceCities = providers && providers.length > 0 ? (providers[0].service_cities || '[]') : '[]'
    const providerServiceAreas = providers && providers.length > 0 ? (providers[0].service_areas || '[]') : '[]'

    let parsedCities = [];
    try { 
      parsedCities = typeof providerServiceCities === 'string' ? JSON.parse(providerServiceCities) : providerServiceCities; 
    } catch (e) {
      parsedCities = [];
    }
    if (!Array.isArray(parsedCities)) parsedCities = [];

    let parsedAreas = [];
    try { 
      parsedAreas = typeof providerServiceAreas === 'string' ? JSON.parse(providerServiceAreas) : providerServiceAreas; 
    } catch (e) {
      parsedAreas = [];
    }
    if (!Array.isArray(parsedAreas)) parsedAreas = [];

    const numericIds = [];
    const stringTokens = [];

    [...parsedCities, ...parsedAreas].forEach(item => {
      if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
        numericIds.push(parseInt(item, 10));
      } else if (typeof item === 'string' && item.trim()) {
        stringTokens.push(item.trim());
      }
    });

    let dbCityNames = [];
    if (numericIds.length > 0) {
      try {
        const placeholders = numericIds.map(() => '?').join(',');
        const areasResult = await execute(`SELECT name FROM cities WHERE id IN (${placeholders})`, numericIds);
        if (areasResult && areasResult.length > 0) {
          dbCityNames = areasResult.map(a => a.name);
        }
      } catch (e) {
        console.error('Error fetching provider area names:', e);
      }
    }

    const allowedLocationTokens = [];
    if (providerCity && providerCity.trim()) allowedLocationTokens.push(providerCity.trim());

    dbCityNames.forEach(name => {
      if (name && !allowedLocationTokens.some(t => t.toLowerCase() === name.toLowerCase())) {
        allowedLocationTokens.push(name.trim());
      }
    });

    stringTokens.forEach(token => {
      if (token && !allowedLocationTokens.some(t => t.toLowerCase() === token.toLowerCase())) {
        allowedLocationTokens.push(token.trim());
      }
    });

    const allParam = searchParams.get('all') === 'true'
    
    // Filter open jobs
    let locationCondition = ''
    const locationParams = []
    
    if (allParam) {
      locationCondition = ''
    } else if (cityParam) {
      const search = `%${cityParam.toLowerCase().trim()}%`;
      locationCondition = 'AND (LOWER(b.city) LIKE ? OR LOWER(b.address_line1) LIKE ? OR LOWER(b.cluster) LIKE ?)'
      locationParams.push(search, search, search)
    } else if (allowedLocationTokens.length > 0) {
      const tokenConditions = [];
      allowedLocationTokens.forEach(token => {
        const searchPattern = `%${token.toLowerCase()}%`;
        tokenConditions.push(`(LOWER(b.city) LIKE ? OR LOWER(b.address_line1) LIKE ? OR LOWER(b.cluster) LIKE ?)`);
        locationParams.push(searchPattern, searchPattern, searchPattern);
      });
      tokenConditions.push(`(b.city IS NULL OR b.city = '' OR b.cluster IS NULL OR b.cluster = '')`);
      locationCondition = `AND (${tokenConditions.join(' OR ')})`;
    } else {
      locationCondition = '';
    }

    // ✅ Optimized: If only count is needed, run a lighter query
    if (countOnly) {
      const countSql = `
        SELECT COUNT(*) as count
        FROM bookings b
        WHERE (
          (b.provider_id = ? AND b.status IN ('pending', 'matching'))
          OR
          (b.provider_id IS NULL AND b.status IN ('pending', 'matching', 'unassigned', 'open') ${locationCondition})
        )
      `
      const countResult = await query(countSql, [providerId, ...locationParams])

      const previewSql = `
        SELECT id, service_name, job_date, city, provider_amount, service_price, commission_percent
        FROM bookings b
        WHERE (
          (b.provider_id = ? AND b.status IN ('pending', 'matching'))
          OR
          (b.provider_id IS NULL AND b.status IN ('pending', 'matching', 'unassigned', 'open') ${locationCondition})
        )
        ORDER BY created_at DESC
        LIMIT ?
      `
      const previewJobs = await query(previewSql, [providerId, ...locationParams, previewLimit])

      const recentJobs = (previewJobs || []).map(job => {
        const comm = job.commission_percent !== null ? parseFloat(job.commission_percent) : defaultComm
        const earnings = job.provider_amount || (parseFloat(job.service_price || 0) * (1 - comm / 100))

        return {
          id: job.id,
          service_name: job.service_name,
          display_amount: `$${parseFloat(earnings).toFixed(2)}`,
          job_date: job.job_date,
          city: job.city
        }
      })

      return NextResponse.json({
        success: true,
        count: (countResult && countResult[0]) ? (countResult[0].count || 0) : 0,
        recentJobs,
        provider_city: providerCity,
        provider_area_names: allowedLocationTokens
      })
    }

    const sql = `
      SELECT
        b.id, b.booking_number, b.service_name, b.job_date, b.job_time_slot,
        b.address_line1, b.city, b.cluster, b.postal_code,
        b.job_description, b.parking_access, b.elevator_access, b.has_pets,
        b.status, b.created_at, b.provider_id,
        b.provider_amount, b.commission_percent,
        b.service_price, b.additional_price as overtime_rate,
        s.image_url as service_image,
        s.duration_minutes as service_duration,
        c.name as category_name, c.icon as category_icon,
        sa.name as service_area_name, sa.cluster_group as service_area_group,
        (SELECT GROUP_CONCAT(photo_url) FROM booking_photos WHERE booking_id = b.id) as photos_csv,
        CASE WHEN b.provider_id = ? THEN 1 ELSE 0 END as admin_assigned
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN service_categories c ON s.category_id = c.id
      LEFT JOIN service_areas sa ON b.cluster = sa.cluster_key
      WHERE (
        -- ✅ Admin pre-assigned to THIS provider (always show these)
        (
          b.provider_id = ?
          AND b.status IN ('pending', 'matching')
        )
        OR
        -- ✅ Open jobs
        (
          b.provider_id IS NULL
          AND b.status IN ('pending', 'matching', 'unassigned', 'open')
          ${locationCondition}
        )
      )
      ORDER BY admin_assigned DESC, b.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    // Execute count query for pagination
    const countSql = `
      SELECT COUNT(*) as total
      FROM bookings b
      WHERE (
        (b.provider_id = ? AND b.status IN ('pending', 'matching'))
        OR
        (b.provider_id IS NULL AND b.status IN ('pending', 'matching', 'unassigned', 'open') ${locationCondition})
      )
    `
    const countParams = [providerId, ...locationParams]
    const countResult = await query(countSql, countParams)
    const totalJobs = countResult && countResult[0] ? countResult[0].total : 0

    const params = [
      providerId,
      providerId,
      ...locationParams
    ]

    const jobs = await execute(sql, params)

    const processedJobs = (jobs || []).map(job => {
      const j = { ...job }
      if (j.job_time_slot) j.job_time_slot = j.job_time_slot.split(',')

      j.photos = j.photos_csv ? j.photos_csv.split(',') : []
      delete j.photos_csv

      const commPct = j.commission_percent !== null ? parseFloat(j.commission_percent) : defaultComm
      const basePrice = parseFloat(j.service_price || 0)
      const otRate = parseFloat(j.overtime_rate || 0)
      const providerAmount = j.commission_percent !== null ? parseFloat(j.provider_amount || 0) : 0
      const duration = j.service_duration || 60
      const commAmt = basePrice * (commPct / 100)
      const baseEarnings = basePrice - commAmt
      const netOT = otRate * (1 - commPct / 100)

      j.pricing = {
        is_approved: true,
        base_price: basePrice,
        commission_percent: commPct,
        commission_amount: commAmt,
        provider_base_earnings: baseEarnings,
        has_overtime: otRate > 0,
        overtime_rate: otRate,
        net_overtime_rate: netOT,
        total_provider_amount: providerAmount || baseEarnings,
        duration_minutes: duration,
      }

      if (otRate > 0) {
        j.overtime_info = {
          rate_per_hour: otRate,
          net_rate_per_hour: netOT,
          example_1hr: baseEarnings + netOT,
          example_2hr: baseEarnings + netOT * 2,
          message: `💰 Overtime: +$${otRate.toFixed(2)}/hr ($${netOT.toFixed(2)} after commission)`,
        }
      }

      j.display_amount = `$${(providerAmount || baseEarnings).toFixed(2)}`
      j.is_admin_assigned = j.admin_assigned === 1
      
      // MASK ADDRESS FOR AVAILABLE JOBS
      // If the job is NOT confirmed by THIS provider, hide the exact address.
      if (j.provider_id !== providerId && j.status !== 'confirmed' && j.status !== 'in_progress') {
        j.address_line1 = j.city || 'Hidden (Area only)';
      }
      
      return j
    })

    return NextResponse.json({ 
      success: true, 
      data: processedJobs, 
      provider_city: providerCity, 
      provider_area_names: allowedLocationTokens,
      total: totalJobs,
      hasMore: processedJobs.length === limit,
      page,
      limit
    })

  } catch (error) {
    console.error('Error fetching available jobs:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch jobs' }, { status: 500 })
  }
}

// ── POST: Accept a job ────────────────────────────────────────────────────────
export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  let connection
  try {
    const providerId = auth.caller.id;

    const { booking_id } = await request.json()
    if (!booking_id) return NextResponse.json({ success: false, message: 'booking_id is required' }, { status: 400 })

    const defaultCommRaw = await getSystemSetting('default_commission', '20')
    const defaultComm = parseFloat(defaultCommRaw)

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      const [[job]] = await connection.execute(
        `SELECT b.id, b.provider_id, b.status, b.provider_amount, b.service_name,
                b.commission_percent, b.service_price, b.additional_price as overtime_rate,
                s.duration_minutes as service_duration
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         WHERE b.id = ? FOR UPDATE`,
        [booking_id]
      )

      if (!job) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 })
      }

      const commPct = job.commission_percent !== null ? parseFloat(job.commission_percent) : defaultComm

      if (job.provider_id !== null && job.provider_id !== providerId) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: 'Job already accepted by another provider' }, { status: 409 })
      }

      if (!['pending', 'matching', 'unassigned', 'open'].includes(job.status)) {
        await connection.query('ROLLBACK')
        return NextResponse.json({ success: false, message: `Job not available (status: ${job.status})` }, { status: 409 })
      }

      // ✅ Update commission_percent if it was null
      if (job.commission_percent === null) {
        await connection.execute(
          'UPDATE bookings SET commission_percent = ? WHERE id = ?',
          [commPct, booking_id]
        )
      }

      await connection.execute(
        `UPDATE bookings SET provider_id = ?, status = 'confirmed', accepted_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [providerId, booking_id]
      )
      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'confirmed', ?)`,
        [booking_id, `Accepted by provider #${providerId}`]
      )

      await connection.query('COMMIT')

      try {
        const bookingRows = await execute(
          'SELECT user_id, booking_number FROM bookings WHERE id = ?',
          [booking_id]
        );
        const booking = bookingRows[0];
        if (booking?.user_id) {
          notifyUser(
            booking.user_id,
            '✅ Provider Confirmed!',
            `A provider has accepted your booking #${booking.booking_number || booking_id} for ${job.service_name}.`,
            { bookingId: booking_id, type: 'booking_confirmed' },
            execute,
            'customer'
          ).catch(e => console.warn('[Push] notify customer error:', e.message));
        }
      } catch (_) { }

      const basePrice = parseFloat(job.service_price || 0)
      const otRate = parseFloat(job.overtime_rate || 0)
      const baseEarnings = basePrice * (1 - commPct / 100)
      const netOT = otRate * (1 - commPct / 100)

      const response = {
        success: true,
        message: `You accepted: ${job.service_name}`,
        provider_amount: job.provider_amount || baseEarnings,
      }

      if (otRate > 0) {
        response.overtime_info = {
          rate_per_hour: otRate,
          net_rate_per_hour: netOT,
          message: `Overtime available at $${otRate.toFixed(2)}/hr.`
        }
      }

      return NextResponse.json(response)

    } catch (err) {
      if (connection) await connection.query('ROLLBACK')
      throw err
    } finally {
      if (connection) connection.release()
    }

  } catch (error) {
    console.error('Error accepting job:', error)
    return NextResponse.json({ success: false, message: 'Failed to accept job: ' + error.message }, { status: 500 })
  }
}
