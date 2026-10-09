import db from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';

// PUT update testimonial
export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, stars, text, is_active, display_order } = body;
    await db.execute(
      'UPDATE testimonials SET name=?, stars=?, text=?, is_active=?, display_order=? WHERE id=?',
      [name, stars ?? 5, text, is_active ?? 1, display_order ?? 0, id]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

// DELETE testimonial
export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    await db.execute('DELETE FROM testimonials WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}
