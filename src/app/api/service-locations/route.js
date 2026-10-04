import { NextResponse } from 'next/server';
import { execute, query } from '@/lib/db';
import { callerFrom, requireCaller } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET service locations
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceSlug = searchParams.get('serviceSlug') || searchParams.get('service');
    const locationSlug = searchParams.get('locationSlug') || searchParams.get('location');
    const limit = searchParams.get('limit');
    const asksForInactive = searchParams.get('includeInactive') === 'true' || searchParams.get('admin') === 'true';
    // The inactive rows are an admin's to see: for any other caller the flags are ignored, as if they were not sent.
    const includeInactive = asksForInactive && (await callerFrom(request, ['admin'])) !== null;

    let sql = `
      SELECT 
        sl.*,
        s.name as service_name,
        s.slug as service_slug,
        s.description as service_description,
        s.short_description as service_short_description,
        s.base_price,
        s.image_url as service_image
      FROM service_locations sl
      JOIN services s ON sl.service_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (!includeInactive) {
      sql += ' AND sl.is_active = 1 AND s.is_active = 1';
    }

    if (serviceSlug) {
      sql += ' AND s.slug = ?';
      params.push(serviceSlug);
    }

    if (locationSlug) {
      sql += ' AND (sl.location_slug = ? OR LOWER(sl.location_name) = ?)';
      params.push(locationSlug, locationSlug.toLowerCase());
    }

    sql += ' ORDER BY sl.location_name ASC, s.name ASC';

    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (!isNaN(parsedLimit)) {
        sql += ` LIMIT ${parsedLimit}`;
      }
    }

    const rows = await query(sql, params);

    if (serviceSlug && locationSlug) {
      if (rows && rows.length > 0) {
        return NextResponse.json({ success: true, data: rows[0] });
      }
      return NextResponse.json({ success: false, message: 'Service location not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error in GET /api/service-locations:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch service locations', error: error.message },
      { status: 500 }
    );
  }
}

// POST create or upsert service location
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const {
      id,
      service_id,
      location_name,
      location_slug,
      slug,
      meta_title,
      meta_description,
      keywords,
      canonical_url,
      custom_heading,
      custom_intro,
      description,
      is_active
    } = await request.json();

    if (!service_id || !location_name || !location_slug) {
      return NextResponse.json(
        { success: false, message: 'service_id, location_name, and location_slug are required' },
        { status: 400 }
      );
    }

    // Fetch service slug to build clean composite slug
    const services = await query('SELECT slug, name FROM services WHERE id = ?', [service_id]);
    if (!services || services.length === 0) {
      return NextResponse.json({ success: false, message: 'Invalid service_id' }, { status: 400 });
    }

    const cleanLocSlug = location_slug.toLowerCase().trim().replace(/^in-/, '').replace(/\s+/g, '-');
    const comboSlug = slug || `${services[0].slug}-in-${cleanLocSlug}`;

    if (id) {
      await execute(
        `UPDATE service_locations SET
          service_id = ?,
          location_name = ?,
          location_slug = ?,
          slug = ?,
          meta_title = ?,
          meta_description = ?,
          keywords = ?,
          canonical_url = ?,
          custom_heading = ?,
          custom_intro = ?,
          description = ?,
          is_active = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          service_id,
          location_name,
          cleanLocSlug,
          comboSlug,
          meta_title || null,
          meta_description || null,
          keywords || null,
          canonical_url || null,
          custom_heading || null,
          custom_intro || null,
          description !== undefined ? description : null,
          is_active !== undefined ? (is_active ? 1 : 0) : 1,
          id
        ]
      );
      return NextResponse.json({
        success: true,
        message: 'Service location updated successfully',
        id
      });
    }

    const result = await execute(
      `INSERT INTO service_locations 
        (service_id, location_name, location_slug, slug, meta_title, meta_description, keywords, canonical_url, custom_heading, custom_intro, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        location_name = VALUES(location_name),
        meta_title = VALUES(meta_title),
        meta_description = VALUES(meta_description),
        keywords = VALUES(keywords),
        canonical_url = VALUES(canonical_url),
        custom_heading = VALUES(custom_heading),
        custom_intro = VALUES(custom_intro),
        description = VALUES(description),
        is_active = VALUES(is_active)`,
      [
        service_id,
        location_name,
        cleanLocSlug,
        comboSlug,
        meta_title || null,
        meta_description || null,
        keywords || null,
        canonical_url || null,
        custom_heading || null,
        custom_intro || null,
        description !== undefined ? description : null,
        is_active !== undefined ? (is_active ? 1 : 0) : 1
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Service location created/updated successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error in POST /api/service-locations:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create service location', error: error.message },
      { status: 500 }
    );
  }
}

// DELETE service location
export async function DELETE(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: 'ID is required' }, { status: 400 });
    }
    await execute('DELETE FROM service_locations WHERE id = ?', [id]);
    return NextResponse.json({ success: true, message: 'Service location deleted successfully' });
  } catch (error) {
    console.error('Error in DELETE /api/service-locations:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete service location', error: error.message },
      { status: 500 }
    );
  }
}
