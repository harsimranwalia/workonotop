import { NextResponse } from 'next/server';
import { query, execute } from '@/lib/db';
import { logActivity } from '@/lib/logger';
import { requireCaller } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET single service location
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, message: 'Invalid ID' }, { status: 400 });
    }

    const rows = await query(
      `SELECT sl.*, s.name as service_name, s.slug as service_slug
       FROM service_locations sl
       LEFT JOIN services s ON sl.service_id = s.id
       WHERE sl.id = ? LIMIT 1`,
      [id]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Service location not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error in GET /api/admin/service-locations/[id]:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch service location', error: error.message },
      { status: 500 }
    );
  }
}

// PUT update service location
export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, message: 'Invalid ID' }, { status: 400 });
    }

    const existingRows = await query('SELECT * FROM service_locations WHERE id = ? LIMIT 1', [id]);
    if (!existingRows || existingRows.length === 0) {
      return NextResponse.json({ success: false, message: 'Service location not found' }, { status: 404 });
    }
    const existing = existingRows[0];

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

    const finalServiceId = service_id !== undefined ? service_id : existing.service_id;
    const finalLocationName = location_name !== undefined ? location_name.trim() : existing.location_name;
    const finalLocationSlug = location_slug !== undefined ? location_slug.trim() : existing.location_slug;
    const finalSlug = slug !== undefined ? slug.trim() : existing.slug;
    const finalMetaTitle = meta_title !== undefined ? meta_title : existing.meta_title;
    const finalMetaDesc = meta_description !== undefined ? meta_description : existing.meta_description;
    const finalKeywords = keywords !== undefined ? keywords : existing.keywords;
    const finalCanonicalUrl = canonical_url !== undefined ? canonical_url : existing.canonical_url;
    const finalOgTitle = og_title !== undefined ? og_title : existing.og_title;
    const finalOgDescription = og_description !== undefined ? og_description : existing.og_description;
    const finalOgImage = og_image !== undefined ? og_image : existing.og_image;
    const finalCustomHeading = custom_heading !== undefined ? custom_heading : existing.custom_heading;
    const finalCustomIntro = custom_intro !== undefined ? custom_intro : existing.custom_intro;
    const finalDescription = description !== undefined ? description : existing.description;
    const finalIsActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;

    // Check slug uniqueness if changed
    if (finalSlug !== existing.slug) {
      const slugCheck = await query('SELECT id FROM service_locations WHERE slug = ? AND id != ? LIMIT 1', [finalSlug, id]);
      if (slugCheck && slugCheck.length > 0) {
        return NextResponse.json(
          { success: false, message: `URL slug "${finalSlug}" is already used by another location.` },
          { status: 409 }
        );
      }
    }

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
        og_title = ?,
        og_description = ?,
        og_image = ?,
        custom_heading = ?,
        custom_intro = ?,
        description = ?,
        is_active = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [
        finalServiceId,
        finalLocationName,
        finalLocationSlug,
        finalSlug,
        finalMetaTitle,
        finalMetaDesc,
        finalKeywords,
        finalCanonicalUrl,
        finalOgTitle,
        finalOgDescription,
        finalOgImage,
        finalCustomHeading,
        finalCustomIntro,
        finalDescription,
        finalIsActive,
        id
      ]
    );

    await logActivity({
      actor_type: 'admin',
      actor_name: auth.caller.email || 'Admin',
      action: 'SERVICE_LOCATION_UPDATED',
      entity_type: 'service_location',
      entity_id: id,
      details: { location_name: finalLocationName, slug: finalSlug, is_active: finalIsActive }
    });

    return NextResponse.json({
      success: true,
      message: 'Service location updated successfully'
    });
  } catch (error) {
    console.error('Error in PUT /api/admin/service-locations/[id]:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update service location', error: error.message },
      { status: 500 }
    );
  }
}

// PATCH toggle active status
export async function PATCH(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, message: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();
    const { is_active } = body;
    const newStatus = is_active ? 1 : 0;

    await execute('UPDATE service_locations SET is_active = ?, updated_at = NOW() WHERE id = ?', [newStatus, id]);

    await logActivity({
      actor_type: 'admin',
      actor_name: auth.caller.email || 'Admin',
      action: 'SERVICE_LOCATION_STATUS_TOGGLED',
      entity_type: 'service_location',
      entity_id: id,
      details: { is_active: newStatus }
    });

    return NextResponse.json({
      success: true,
      message: `Service location is now ${newStatus ? 'Active' : 'Inactive'}`,
      is_active: newStatus
    });
  } catch (error) {
    console.error('Error in PATCH /api/admin/service-locations/[id]:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to toggle status', error: error.message },
      { status: 500 }
    );
  }
}

// DELETE service location
export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, message: 'Invalid ID' }, { status: 400 });
    }

    const existingRows = await query('SELECT id, location_name, slug FROM service_locations WHERE id = ? LIMIT 1', [id]);
    if (!existingRows || existingRows.length === 0) {
      return NextResponse.json({ success: false, message: 'Service location not found' }, { status: 404 });
    }
    const loc = existingRows[0];

    await execute('DELETE FROM service_locations WHERE id = ?', [id]);

    await logActivity({
      actor_type: 'admin',
      actor_name: auth.caller.email || 'Admin',
      action: 'SERVICE_LOCATION_DELETED',
      entity_type: 'service_location',
      entity_id: id,
      details: { location_name: loc.location_name, slug: loc.slug }
    });

    return NextResponse.json({
      success: true,
      message: `Service location "${loc.location_name}" deleted successfully`
    });
  } catch (error) {
    console.error('Error in DELETE /api/admin/service-locations/[id]:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete service location', error: error.message },
      { status: 500 }
    );
  }
}
