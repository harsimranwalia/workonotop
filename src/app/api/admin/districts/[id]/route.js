import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const rows = await pool.execute(`
      SELECT d.*, s.name as state_name 
      FROM districts d
      LEFT JOIN states s ON d.state_id = s.id
      WHERE d.id = ?
    `, [id]);
    
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: 'District not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching district:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch district' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, state_id, is_active } = body;

    if (!name || !state_id) {
      return NextResponse.json({ success: false, message: 'Name and State ID are required' }, { status: 400 });
    }

    await pool.execute(
      'UPDATE districts SET name = ?, state_id = ?, is_active = ? WHERE id = ?',
      [name, state_id, is_active ? 1 : 0, id]
    );

    return NextResponse.json({ success: true, message: 'District updated successfully' });
  } catch (error) {
    console.error('Error updating district:', error);
    return NextResponse.json({ success: false, message: 'Failed to update district' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;

    await pool.execute('DELETE FROM districts WHERE id = ?', [id]);

    return NextResponse.json({ success: true, message: 'District deleted successfully' });
  } catch (error) {
    console.error('Error deleting district:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete district' }, { status: 500 });
  }
}
