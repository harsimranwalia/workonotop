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
    const districtId = searchParams.get('district_id');
    const search = searchParams.get('search') || '';

    if (isAll) {
      let query = `
        SELECT c.id, c.name 
        FROM cities c 
        JOIN districts d ON c.district_id = d.id 
        JOIN states s ON d.state_id = s.id 
        WHERE c.is_active = 1 AND d.is_active = 1 AND s.is_active = 1
      `;
      let params = [];
      if (districtId) {
        query += ' AND c.district_id = ?';
        params.push(districtId);
      }
      query += ' ORDER BY c.name ASC';
      const rows = await pool.query(query, params);
      return NextResponse.json({ success: true, data: rows });
    }

    let countQuery = 'SELECT COUNT(*) as count FROM cities c';
    let dataQuery = `
      SELECT c.*, d.name as district_name, s.name as state_name 
      FROM cities c
      LEFT JOIN districts d ON c.district_id = d.id
      LEFT JOIN states s ON d.state_id = s.id
      WHERE 1=1
    `;
    let queryParams = [];

    if (districtId) {
      countQuery += ' WHERE c.district_id = ?';
      dataQuery += ' AND c.district_id = ?';
      queryParams.push(districtId);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      if (queryParams.length > 0) {
        countQuery += ' AND c.name LIKE ?';
      } else {
        countQuery += ' WHERE c.name LIKE ?';
      }
      dataQuery += ' AND c.name LIKE ?';
      queryParams.push(searchPattern);
    }

    dataQuery += ' ORDER BY c.name ASC LIMIT ? OFFSET ?';
    
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
    console.error('Error fetching cities:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch cities' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { name, district_id, is_active } = body;

    if (!name || !district_id) {
      return NextResponse.json({ success: false, message: 'Name and District ID are required' }, { status: 400 });
    }

    const result = await pool.execute(
      'INSERT INTO cities (name, district_id, is_active) VALUES (?, ?, ?)',
      [name, district_id, is_active === undefined ? 1 : is_active ? 1 : 0]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'City created successfully',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Error creating city:', error);
    return NextResponse.json({ success: false, message: 'Failed to create city' }, { status: 500 });
  }
}
