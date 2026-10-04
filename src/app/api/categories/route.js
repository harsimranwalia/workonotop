// app/api/categories/route.js
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'  // ✅ CHANGE: query → execute
import { logActivity } from '@/lib/logger'
import { requireCaller } from '@/lib/api-auth'

// GET all service categories
export async function GET() {
  try {
    // ✅ execute() use karo - simple query
    const categories = await execute(
      'SELECT * FROM service_categories WHERE is_active = TRUE ORDER BY display_order, name'
    )
    
    return NextResponse.json({ 
      success: true, 
      data: categories 
    })
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

// POST create new category
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { name, slug, icon, description, display_order, image_url } = await request.json()

    if (!name || !slug) {
      return NextResponse.json(
        { success: false, message: 'Name and slug are required' },
        { status: 400 }
      )
    }

    // ✅ execute() use karo
    const result = await execute(
      'INSERT INTO service_categories (name, slug, icon, description, display_order, image_url) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, icon || null, description || null, display_order || 0, image_url || null]
    )

    // Log Activity
    logActivity({
      actor_id: 1, // Admin (hardcoded for now, token extraction can be added later)
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'CATEGORY_CREATED',
      entity_type: 'category',
      entity_id: result.insertId,
      details: { name, slug }
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Category created',
      id: result.insertId 
    })
  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create category' },
      { status: 500 }
    )
  }
}

// PUT update category
export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id, name, slug, icon, description, is_active, display_order, image_url } = await request.json()

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'ID is required' },
        { status: 400 }
      )
    }

    // ✅ execute() use karo
    await execute(
      'UPDATE service_categories SET name = ?, slug = ?, icon = ?, description = ?, is_active = ?, display_order = ?, image_url = ? WHERE id = ?',
      [name, slug, icon, description, is_active, display_order, image_url, id]
    )

    // Log Activity
    logActivity({
      actor_id: 1,
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'CATEGORY_UPDATED',
      entity_type: 'category',
      entity_id: id,
      details: { name, slug, is_active }
    })

    return NextResponse.json({ success: true, message: 'Category updated' })
  } catch (error) {
    console.error('Error updating category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update category' },
      { status: 500 }
    )
  }
}

// DELETE category
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

    // ✅ execute() use karo
    await execute('DELETE FROM service_categories WHERE id = ?', [id])
    
    // Log Activity
    logActivity({
      actor_id: 1,
      actor_type: 'admin',
      actor_name: 'Admin',
      action: 'CATEGORY_DELETED',
      entity_type: 'category',
      entity_id: id
    })

    return NextResponse.json({ success: true, message: 'Category deleted' })
  } catch (error) {
    console.error('Error deleting category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete category' },
      { status: 500 }
    )
  }
}