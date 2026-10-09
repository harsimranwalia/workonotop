import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const rows = await pool.execute('SELECT * FROM states WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: 'State not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching state:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch state' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, is_active } = body;

    if (!name) {
      return NextResponse.json({ success: false, message: 'Name is required' }, { status: 400 });
    }

    await pool.execute(
      'UPDATE states SET name = ?, is_active = ? WHERE id = ?',
      [name, is_active ? 1 : 0, id]
    );

    return NextResponse.json({ success: true, message: 'State updated successfully' });
  } catch (error) {
    console.error('Error updating state:', error);
    return NextResponse.json({ success: false, message: 'Failed to update state' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;

    await pool.execute('DELETE FROM states WHERE id = ?', [id]);

    return NextResponse.json({ success: true, message: 'State deleted successfully' });
  } catch (error) {
    console.error('Error deleting state:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete state' }, { status: 500 });
  }
}
