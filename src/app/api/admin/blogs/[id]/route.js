import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const id = params.id;
    const rows = await db.query('SELECT * FROM blogs WHERE id = ?', [id]);
    
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Blog not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching blog:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch blog' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const id = params.id;
    const body = await request.json();
    const { title, slug, content, author, image_url, meta_title, meta_description, keywords, is_published } = body;

    if (!title || !slug) {
      return NextResponse.json({ success: false, message: 'Title and slug are required' }, { status: 400 });
    }

    await db.query(
      `UPDATE blogs 
       SET title = ?, slug = ?, content = ?, author = ?, image_url = ?, meta_title = ?, meta_description = ?, keywords = ?, is_published = ?
       WHERE id = ?`,
      [title, slug, content || '', author || '', image_url || '', meta_title || '', meta_description || '', keywords || '', is_published ? 1 : 0, id]
    );

    return NextResponse.json({ success: true, message: 'Blog updated' });
  } catch (error) {
    console.error('Error updating blog:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, message: 'Blog slug already exists' }, { status: 400 });
    }
    return NextResponse.json({ success: false, message: 'Failed to update blog' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const id = params.id;
    await db.query('DELETE FROM blogs WHERE id = ?', [id]);
    return NextResponse.json({ success: true, message: 'Blog deleted' });
  } catch (error) {
    console.error('Error deleting blog:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete blog' }, { status: 500 });
  }
}
