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
    const stateId = searchParams.get('state_id');
    const search = searchParams.get('search') || '';

    if (isAll) {
      let query = 'SELECT d.id, d.name FROM districts d JOIN states s ON d.state_id = s.id WHERE d.is_active = 1 AND s.is_active = 1';
      let params = [];
      if (stateId) {
        query += ' AND d.state_id = ?';
        params.push(stateId);
      }
      query += ' ORDER BY d.name ASC';
      const rows = await pool.query(query, params);
      return NextResponse.json({ success: true, data: rows });
    }

    let countQuery = 'SELECT COUNT(*) as count FROM districts d';
    let dataQuery = `
      SELECT d.*, s.name as state_name 
      FROM districts d
      LEFT JOIN states s ON d.state_id = s.id
      WHERE 1=1
    `;
    let queryParams = [];

    if (stateId) {
      countQuery += ' WHERE d.state_id = ?';
      dataQuery += ' AND d.state_id = ?';
      queryParams.push(stateId);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      if (queryParams.length > 0) {
        countQuery += ' AND d.name LIKE ?';
      } else {
        countQuery += ' WHERE d.name LIKE ?';
      }
      dataQuery += ' AND d.name LIKE ?';
      queryParams.push(searchPattern);
    }

    dataQuery += ' ORDER BY d.name ASC LIMIT ? OFFSET ?';
    
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
    console.error('Error fetching districts:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch districts' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { name, state_id, is_active } = body;

    if (!name || !state_id) {
      return NextResponse.json({ success: false, message: 'Name and State ID are required' }, { status: 400 });
    }

    const result = await pool.execute(
      'INSERT INTO districts (name, state_id, is_active) VALUES (?, ?, ?)',
      [name, state_id, is_active === undefined ? 1 : is_active ? 1 : 0]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'District created successfully',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Error creating district:', error);
    return NextResponse.json({ success: false, message: 'Failed to create district' }, { status: 500 });
  }
}
