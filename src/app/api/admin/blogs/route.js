import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const rows = await db.query('SELECT * FROM blogs ORDER BY created_at DESC');
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching blogs:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch blogs' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { title, slug, content, author, image_url, meta_title, meta_description, keywords, is_published } = body;

    if (!title || !slug) {
      return NextResponse.json({ success: false, message: 'Title and slug are required' }, { status: 400 });
    }

    const result = await db.query(
      `INSERT INTO blogs (title, slug, content, author, image_url, meta_title, meta_description, keywords, is_published) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, slug, content || '', author || '', image_url || '', meta_title || '', meta_description || '', keywords || '', is_published ? 1 : 0]
    );

    return NextResponse.json({ success: true, message: 'Blog created', data: { id: result.insertId } });
  } catch (error) {
    console.error('Error creating blog:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, message: 'Blog slug already exists' }, { status: 400 });
    }
    return NextResponse.json({ success: false, message: 'Failed to create blog' }, { status: 500 });
  }
}
