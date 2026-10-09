import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) as count FROM service_areas');
    const total = countResult[0].count;

    const rows = await pool.query(
      'SELECT * FROM service_areas ORDER BY cluster_group, name LIMIT ? OFFSET ?',
      [limit, offset]
    );

    return NextResponse.json({ 
      success: true, 
      data: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching service areas:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch service areas' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { name, cluster_group, is_active, cities } = body;

    if (!name || !cluster_group) {
      return NextResponse.json({ success: false, message: 'Name and Cluster Group are required' }, { status: 400 });
    }

    // Generate a cluster key from the name and group
    const cluster_key = `${cluster_group.toUpperCase().replace(/\s+/g, '_')}_${name.toUpperCase().replace(/\s+/g, '_')}`;
    const citiesJson = Array.isArray(cities) ? JSON.stringify(cities) : '[]';

    const result = await pool.execute(
      'INSERT INTO service_areas (name, cluster_group, cluster_key, is_active, cities) VALUES (?, ?, ?, ?, ?)',
      [name, cluster_group, cluster_key, is_active === undefined ? 1 : is_active ? 1 : 0, citiesJson]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Service area created successfully',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Error creating service area:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, message: 'A service area with this name and group already exists.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, message: 'Failed to create service area' }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { name, cluster_group, is_active, cities } = body;

    const citiesJson = Array.isArray(cities) ? JSON.stringify(cities) : '[]';

    await pool.execute(
      'UPDATE service_areas SET name = ?, cluster_group = ?, is_active = ?, cities = ? WHERE id = ?',
      [name, cluster_group, is_active ? 1 : 0, citiesJson, id]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Service area updated successfully'
    });
  } catch (error) {
    console.error('Error updating service area:', error);
    return NextResponse.json({ success: false, message: 'Failed to update service area' }, { status: 500 });
  }
}
