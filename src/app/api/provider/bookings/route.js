import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  try {
    const providerId = auth.caller.id;
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');

    let query = `
      SELECT 
        b.id, 
        b.job_date, 
        b.status,
        u.first_name, 
        u.last_name,
        CONCAT(u.first_name, ' ', u.last_name) as customer_name,
        s.name as service_name
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN services s ON b.service_id = s.id
      WHERE b.provider_id = ?
    `;

    const params = [providerId];

    if (statusFilter) {
      const statuses = statusFilter.split(',');
      query += ` AND b.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    query += ` ORDER BY b.created_at DESC`;

    const bookings = await execute(query, params);
    return NextResponse.json({ success: true, bookings });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}