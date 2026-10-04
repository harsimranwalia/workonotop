import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const isAll = searchParams.get('all') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';

    if (isAll) {
      // Return only active states for dropdowns
      const rows = await pool.query('SELECT id, name FROM states WHERE is_active = 1 ORDER BY name ASC');
      return NextResponse.json({ success: true, data: rows });
    }

    let countQuery = 'SELECT COUNT(*) as count FROM states';
    let dataQuery = 'SELECT * FROM states';
    let queryParams = [];

    if (search) {
      countQuery += ' WHERE name LIKE ?';
      dataQuery += ' WHERE name LIKE ?';
      queryParams.push(`%${search}%`);
    }

    dataQuery += ' ORDER BY name ASC LIMIT ? OFFSET ?';

    const countResult = await pool.query(countQuery, queryParams);
    const total = countResult[0].count;

    const rows = await pool.query(dataQuery, [...queryParams, limit, offset]);

    return NextResponse.json({ 
      success: true, 
      data: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching states:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch states' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { name, is_active } = body;

    if (!name) {
      return NextResponse.json({ success: false, message: 'Name is required' }, { status: 400 });
    }

    const result = await pool.execute(
      'INSERT INTO states (name, is_active) VALUES (?, ?)',
      [name, is_active === undefined ? 1 : is_active ? 1 : 0]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'State created successfully',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Error creating state:', error);
    return NextResponse.json({ success: false, message: 'Failed to create state' }, { status: 500 });
  }
}
