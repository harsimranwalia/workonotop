// app/api/services/route.js
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { execute, query } from '@/lib/db'
import { logActivity } from '@/lib/logger'
import { callerFrom, requireCaller } from '@/lib/api-auth'

// GET all services
export async function GET(request) { 
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const categoryId = searchParams.get('category_id') || searchParams.get('categoryId')
    const slug = searchParams.get('slug')
    const location = searchParams.get('location') || searchParams.get('locationSlug')
    const homepage = searchParams.get('homepage')
    const limitParams = searchParams.get('limit')
    // ?admin=true drops the is_active filter: it is an admin's to use; for any other caller the flag is ignored, as if it were not sent.
    const admin = searchParams.get('admin') === 'true' && (await callerFrom(request, ['admin'])) ? 'true' : null

    const locationFields = location ? `
        sl.location_name,
        sl.location_slug,
        COALESCE(sl.meta_title, seo.meta_title) as seo_meta_title,
        COALESCE(sl.meta_description, seo.meta_description) as seo_meta_description,
        COALESCE(sl.keywords, seo.keywords) as seo_keywords,
        COALESCE(sl.canonical_url, seo.canonical_url) as seo_canonical_url,
        sl.custom_heading,
        sl.custom_intro,
        sl.description as location_description
    ` : `
        seo.meta_title as seo_meta_title,
        seo.meta_description as seo_meta_description,
        seo.keywords as seo_keywords,
        seo.canonical_url as seo_canonical_url,
        seo.og_title as seo_og_title,
        seo.og_description as seo_og_description,
        seo.og_image as seo_og_image
    `;

    let sql = `
      SELECT 
        s.*,
        sc.name as category_name,
        sc.slug as category_slug,
        sc.icon as category_icon,
        sc.image_url as category_image_url,
        (SELECT GROUP_CONCAT(location_name SEPARATOR ', ') FROM service_locations sl2 WHERE sl2.service_id = s.id) as locations,
        ${locationFields}
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.id
      LEFT JOIN seo_settings seo ON seo.page_name = CONCAT('/services/', s.slug)
      ${location ? 'LEFT JOIN service_locations sl ON sl.service_id = s.id AND (sl.location_slug = ? OR LOWER(sl.location_name) = ?)' : ''}
      WHERE 1=1
    `
    const params = []
    if (location) {
      params.push(location.toLowerCase(), location.toLowerCase())
    }

    if (admin !== 'true') {
      sql += ' AND s.is_active = 1'
    }

    if (id) {
      sql += ' AND s.id = ?'
      params.push(id)
    }

    if (categoryId) {
      sql += ' AND s.category_id = ?'
      params.push(categoryId)
    }

    if (slug) {
      sql += ' AND s.slug = ?'
      params.push(slug)
    }

    if (homepage === 'true') {
      sql += ' AND s.is_homepage = 1'
    }

    sql += ' ORDER BY sc.display_order, s.name'

    const pageParams = searchParams.get('page')
    
    if (limitParams) {
      const parsedLimit = parseInt(limitParams)
      if (!isNaN(parsedLimit)) {
        sql += ` LIMIT ${parsedLimit}`
        
        if (pageParams) {
          const parsedPage = parseInt(pageParams)
          if (!isNaN(parsedPage) && parsedPage > 0) {
            const offset = (parsedPage - 1) * parsedLimit
            sql += ` OFFSET ${offset}`
          }
        }
      }
    }

    console.log('Executing SQL:', sql);
    const services = await query(sql, params)
    console.log(`Found ${services.length} services`);

    // Parse skills JSON for each service
    const formattedServices = services.map(s => {
      let parsedSkills = []
      try {
        parsedSkills = typeof s.skills === 'string' ? JSON.parse(s.skills) : (s.skills || [])
      } catch (e) {
        parsedSkills = []
      }
      return { ...s, skills: parsedSkills }
    })

    if ((id || slug) && formattedServices.length === 1) {
      return NextResponse.json({
        success: true,
        data: formattedServices[0]
      })
    }

    return NextResponse.json({
      success: true,
      data: formattedServices
    })
  } catch (error) {
    console.error('CRITICAL ERROR in GET /api/services:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch services', error: error.message },
      { status: 500 }
    )
  }
}

// POST (similar changes for all methods)
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const {
      category_id,
      name,
      slug,
      description,
      short_description,
      base_price,
      additional_price,
      duration_minutes,
      image_url,
      use_cases,
      is_homepage,
      is_trending,
      is_popular,
      skills
    } = await request.json()

    if (!category_id || !name || !slug || !base_price) {
      return NextResponse.json(
        { success: false, message: 'Category, name, slug, and base price are required' },
        { status: 400 }
      )
    }

    // ✅ Using execute()
    const result = await execute(
      `INSERT INTO services 
       (category_id, name, slug, description, short_description, base_price, 
        additional_price, duration_minutes, image_url, use_cases,
        is_homepage, is_trending, is_popular, skills) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        category_id,
        name,
        slug,
        description || null,
        short_description || null,
        base_price,
        additional_price || null,
        duration_minutes || null,
        image_url || null,
        use_cases || null,
        is_homepage ? 1 : 0,
        is_trending ? 1 : 0,
        is_popular ? 1 : 0,
        JSON.stringify(Array.isArray(skills) ? skills : [])
      ]
    )

    // Log Activity
    logActivity({
      actor_id: 1, // Admin (hardcoded for now)
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'SERVICE_CREATED',
      entity_type: 'service',
      entity_id: result.insertId,
      details: { name, slug, base_price }
    })

    return NextResponse.json({
      success: true,
      message: 'Service created',
      id: result.insertId
    })
  } catch (error) {
    console.error('Error creating service:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create service' },
      { status: 500 }
    )
  }
}

// PUT and DELETE methods similarly change query() → execute()

// PUT update service
export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const {
      id,
      category_id,
      name,
      slug,
      description,
      short_description,
      base_price,
      additional_price,
      duration_minutes,
      image_url,
      use_cases,
      is_homepage,
      is_trending,
      is_popular,
      is_active,
      skills
    } = await request.json()

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'ID is required' },
        { status: 400 }
      )
    }

    const existingRows = await query('SELECT * FROM services WHERE id = ?', [id])
    const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null

    const finalCategoryId = category_id !== undefined ? category_id : existing?.category_id
    const finalName = name !== undefined ? name : existing?.name
    const finalSlug = slug !== undefined ? slug : existing?.slug
    const finalDescription = description !== undefined ? description : (existing?.description || '')
    const finalShortDescription = short_description !== undefined ? short_description : (existing?.short_description || '')
    const finalBasePrice = base_price !== undefined ? base_price : (existing?.base_price || '0.00')
    const finalAdditionalPrice = additional_price !== undefined ? additional_price : (existing?.additional_price || '0.00')
    const finalDurationMinutes = duration_minutes !== undefined ? duration_minutes : (existing?.duration_minutes || 60)
    const finalImageUrl = image_url !== undefined ? image_url : existing?.image_url
    const finalUseCases = use_cases !== undefined ? use_cases : (existing?.use_cases || '')
    const finalIsHomepage = is_homepage !== undefined ? (is_homepage ? 1 : 0) : (existing ? existing.is_homepage : 0)
    const finalIsTrending = is_trending !== undefined ? (is_trending ? 1 : 0) : (existing ? existing.is_trending : 0)
    const finalIsPopular = is_popular !== undefined ? (is_popular ? 1 : 0) : (existing ? existing.is_popular : 0)
    const finalIsActive = is_active !== undefined ? (is_active ? 1 : 0) : (existing ? existing.is_active : 1)

    let finalSkills
    if (skills !== undefined) {
      finalSkills = JSON.stringify(Array.isArray(skills) ? skills : [])
    } else if (existing?.skills) {
      finalSkills = typeof existing.skills === 'string' ? existing.skills : JSON.stringify(existing.skills)
    } else {
      finalSkills = JSON.stringify([])
    }

    await execute(
      `UPDATE services 
       SET category_id = ?, name = ?, slug = ?, description = ?, short_description = ?, 
           base_price = ?, additional_price = ?, duration_minutes = ?, image_url = ?, 
           use_cases = ?, is_homepage = ?, is_trending = ?, is_popular = ?, is_active = ?, skills = ?
       WHERE id = ?`,
      [
        finalCategoryId,
        finalName,
        finalSlug,
        finalDescription,
        finalShortDescription,
        finalBasePrice,
        finalAdditionalPrice,
        finalDurationMinutes,
        finalImageUrl,
        finalUseCases,
        finalIsHomepage,
        finalIsTrending,
        finalIsPopular,
        finalIsActive,
        finalSkills,
        id
      ]
    )

    // Log Activity
    logActivity({
      actor_id: 1,
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'SERVICE_UPDATED',
      entity_type: 'service',
      entity_id: id,
      details: { name, slug, is_active }
    })

    return NextResponse.json({ success: true, message: 'Service updated' })
  } catch (error) {
    console.error('Error updating service:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update service' },
      { status: 500 }
    )
  }
}

// DELETE service
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

    // Fetch the service first to get the image URL
    const services = await query('SELECT image_url FROM services WHERE id = ?', [id])
    if (services && services.length > 0 && services[0].image_url) {
      const fileUrl = services[0].image_url;
      if (fileUrl.startsWith('/uploads/')) {
        const filename = fileUrl.split('/').pop();
        if (filename) {
          const path = require('path');
          const { unlink } = require('fs/promises');
          const filepath = path.join(process.cwd(), 'public/uploads', filename);
          try {
            await unlink(filepath);
          } catch (fsError) {
            if (fsError.code !== 'ENOENT') {
              console.error('Failed to delete image file:', fsError);
            }
          }
        }
      }
    }

    await execute('DELETE FROM services WHERE id = ?', [id])

    // Log Activity
    logActivity({
      actor_id: 1,
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'SERVICE_DELETED',
      entity_type: 'service',
      entity_id: id
    })

    return NextResponse.json({ success: true, message: 'Service deleted' })
  } catch (error) {
    console.error('Error deleting service:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete service' },
      { status: 500 }
    )
  }
}