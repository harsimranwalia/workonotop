import { NextResponse } from 'next/server';
import pool, { query, execute } from '@/lib/db';
import { logActivity } from '@/lib/logger';
import { requireCaller } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET all service locations with filtering, pagination, and summary stats
export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim();
    const serviceId = searchParams.get('service_id') || searchParams.get('serviceId');
    const status = searchParams.get('status') || 'all'; // all, active, inactive
    const sortBy = searchParams.get('sortBy') || 'location_name';
    const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'DESC' : 'ASC';
    const isAll = searchParams.get('all') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '20', 10));
    const offset = (page - 1) * limit;

    // Build WHERE clauses
    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(sl.location_name LIKE ? OR sl.location_slug LIKE ? OR sl.slug LIKE ? OR s.name LIKE ? OR sl.meta_title LIKE ?)');
      const pattern = `%${search}%`;
      queryParams.push(pattern, pattern, pattern, pattern, pattern);
    }

    if (serviceId && serviceId !== 'all') {
      whereConditions.push('sl.service_id = ?');
      queryParams.push(serviceId);
    }

    if (status === 'active') {
      whereConditions.push('sl.is_active = 1');
    } else if (status === 'inactive') {
      whereConditions.push('sl.is_active = 0');
    }

    const whereSql = whereConditions.join(' AND ');

    // Determine sort column
    let orderSql = 'sl.location_name ASC, s.name ASC';
    if (sortBy === 'service_name') {
      orderSql = `s.name ${sortOrder}, sl.location_name ASC`;
    } else if (sortBy === 'created_at') {
      orderSql = `sl.created_at ${sortOrder}`;
    } else if (sortBy === 'updated_at') {
      orderSql = `sl.updated_at ${sortOrder}`;
    } else if (sortBy === 'status') {
      orderSql = `sl.is_active ${sortOrder}, sl.location_name ASC`;
    } else if (sortBy === 'location_name') {
      orderSql = `sl.location_name ${sortOrder}`;
    }

    // Get Total Count with filters
    const countSql = `
      SELECT COUNT(*) as count 
      FROM service_locations sl
      LEFT JOIN services s ON sl.service_id = s.id
      WHERE ${whereSql}
    `;
    const countResult = await query(countSql, queryParams);
    const total = countResult[0]?.count || 0;

    // Get overall stats (across all items)
    const statsSql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive,
        COUNT(DISTINCT service_id) as services_count,
        COUNT(DISTINCT location_slug) as locations_count
      FROM service_locations
    `;
    const statsResult = await query(statsSql);
    const stats = {
      total: statsResult[0]?.total || 0,
      active: statsResult[0]?.active || 0,
      inactive: statsResult[0]?.inactive || 0,
      servicesCount: statsResult[0]?.services_count || 0,
      locationsCount: statsResult[0]?.locations_count || 0,
    };

    // Main Query
    let dataSql = `
      SELECT 
        sl.*,
        s.name as service_name,
        s.slug as service_slug,
        s.image_url as service_image_url,
        s.base_price,
        s.is_active as service_is_active
      FROM service_locations sl
      LEFT JOIN services s ON sl.service_id = s.id
      WHERE ${whereSql}
      ORDER BY ${orderSql}
    `;

    let dataParams = [...queryParams];
    if (!isAll) {
      dataSql += ' LIMIT ? OFFSET ?';
      dataParams.push(limit, offset);
    }

    const rows = await query(dataSql, dataParams);

    return NextResponse.json({
      success: true,
      data: rows || [],
      pagination: {
        page,
        limit: isAll ? total : limit,
        total,
        totalPages: isAll ? 1 : Math.ceil(total / limit) || 1
      },
      stats
    });
  } catch (error) {
    console.error('Error in GET /api/admin/service-locations:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch service locations', error: error.message },
      { status: 500 }
    );
  }
}

// POST create new service location
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const {
      service_id,
      location_name,
      location_slug,
      slug,
      meta_title,
      meta_description,
      keywords,
      canonical_url,
      og_title,
      og_description,
      og_image,
      custom_heading,
      custom_intro,
      description,
      is_active
    } = body;

    if (!service_id || !location_name) {
      return NextResponse.json(
        { success: false, message: 'Service and Location Name are required' },
        { status: 400 }
      );
    }

    // Verify service exists
    const serviceRows = await query('SELECT id, name, slug FROM services WHERE id = ?', [service_id]);
    if (!serviceRows || serviceRows.length === 0) {
      return NextResponse.json({ success: false, message: 'Invalid service selected' }, { status: 400 });
    }
    const service = serviceRows[0];

    const cleanLocName = location_name.trim();
    const cleanLocSlug = (location_slug || cleanLocName)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    const finalSlug = (slug || `${service.slug}-${cleanLocSlug}`).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    const finalCanonical = canonical_url || `https://workontap.com/services/${finalSlug}`;
    const finalMetaTitle = meta_title || `Best ${service.name} in ${cleanLocName}, BC | WorkOnTap`;
    const finalMetaDesc = meta_description || `Looking for trusted ${service.name.toLowerCase()} in ${cleanLocName}, BC? Book top-rated local pros on WorkOnTap.`;
    const finalHeading = custom_heading || `#1 Rated ${service.name} Pros in ${cleanLocName}, BC`;
    const finalIntro = custom_intro || `Need reliable ${service.name.toLowerCase()} in ${cleanLocName}? WorkOnTap connects you with verified local background-checked specialists ready to handle your job.`;
    const finalIsActive = is_active !== undefined ? (is_active ? 1 : 0) : 1;

    // Check duplicate slug
    const existing = await query('SELECT id FROM service_locations WHERE slug = ?', [finalSlug]);
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { success: false, message: `A service location with URL slug "${finalSlug}" already exists.` },
        { status: 409 }
      );
    }

    const insertResult = await execute(
      `INSERT INTO service_locations
        (service_id, location_name, location_slug, slug, meta_title, meta_description, keywords, canonical_url, og_title, og_description, og_image, custom_heading, custom_intro, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        service_id,
        cleanLocName,
        cleanLocSlug,
        finalSlug,
        finalMetaTitle,
        finalMetaDesc,
        keywords || null,
        finalCanonical,
        og_title || null,
        og_description || null,
        og_image || null,
        finalHeading,
        finalIntro,
        description || null,
        finalIsActive
      ]
    );

    await logActivity({
      actor_type: 'admin',
      actor_name: auth.caller.email || 'Admin',
      action: 'SERVICE_LOCATION_CREATED',
      entity_type: 'service_location',
      entity_id: insertResult.insertId,
      details: { service_name: service.name, location_name: cleanLocName, slug: finalSlug }
    });

    return NextResponse.json({
      success: true,
      message: 'Service location created successfully',
      id: insertResult.insertId
    });
  } catch (error) {
    console.error('Error in POST /api/admin/service-locations:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create service location', error: error.message },
      { status: 500 }
    );
  }
}
