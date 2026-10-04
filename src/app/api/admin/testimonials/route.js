import db from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';

// GET all testimonials (admin, including inactive)
export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const rows = await db.query(
      'SELECT * FROM testimonials ORDER BY display_order ASC, id ASC'
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

// POST create new testimonial
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { name, stars, text, is_active, display_order } = body;
    if (!name || !text) {
      return NextResponse.json({ success: false, error: 'Name and text are required' }, { status: 400 });
    }
    const result = await db.execute(
      'INSERT INTO testimonials (name, stars, text, is_active, display_order) VALUES (?, ?, ?, ?, ?)',
      [name, stars || 5, text, is_active ?? 1, display_order || 0]
    );
    return NextResponse.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}
