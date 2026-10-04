import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const [rows] = await pool.execute('SELECT * FROM service_areas WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Service area not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching service area:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch service area' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, cluster_group, is_active, cities } = body;

    if (!name || !cluster_group) {
      return NextResponse.json({ success: false, message: 'Name and Cluster Group are required' }, { status: 400 });
    }

    const citiesJson = Array.isArray(cities) ? JSON.stringify(cities) : '[]';

    await pool.execute(
      'UPDATE service_areas SET name = ?, cluster_group = ?, is_active = ?, cities = ? WHERE id = ?',
      [name, cluster_group, is_active ? 1 : 0, citiesJson, id]
    );

    return NextResponse.json({ success: true, message: 'Service area updated successfully' });
  } catch (error) {
    console.error('Error updating service area:', error);
    return NextResponse.json({ success: false, message: 'Failed to update service area' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;

    await pool.execute('DELETE FROM service_areas WHERE id = ?', [id]);

    return NextResponse.json({ success: true, message: 'Service area deleted successfully' });
  } catch (error) {
    console.error('Error deleting service area:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete service area' }, { status: 500 });
  }
}
