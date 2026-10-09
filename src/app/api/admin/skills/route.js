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
    const search = searchParams.get('search') || '';

    let countQuery = 'SELECT COUNT(*) as count FROM skills WHERE 1=1';
    let dataQuery = 'SELECT * FROM skills WHERE 1=1';
    let queryParams = [];

    if (search) {
      const searchPattern = `%${search}%`;
      countQuery += ' AND name LIKE ?';
      dataQuery += ' AND name LIKE ?';
      queryParams.push(searchPattern);
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
    console.error('Error fetching skills:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch skills' }, { status: 500 });
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

    // Check if skill already exists
    const existing = await pool.query('SELECT id FROM skills WHERE name = ?', [name]);
    if (existing.length > 0) {
        return NextResponse.json({ success: false, message: 'Skill already exists' }, { status: 400 });
    }

    const result = await pool.execute(
      'INSERT INTO skills (name, is_active) VALUES (?, ?)',
      [name, is_active === undefined ? 1 : is_active ? 1 : 0]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Skill created successfully',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Error creating skill:', error);
    return NextResponse.json({ success: false, message: 'Failed to create skill' }, { status: 500 });
  }
}
