import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const pageName = searchParams.get('page_name');

    if (pageName) {
      const rows = await db.query('SELECT * FROM seo_settings WHERE page_name = ?', [pageName]);
      return NextResponse.json({ success: true, data: rows[0] || null });
    } else {
      const rows = await db.query('SELECT * FROM seo_settings ORDER BY id DESC');
      return NextResponse.json({ success: true, data: rows });
    }
  } catch (error) {
    console.error('Error fetching seo settings:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch seo settings' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { page_name, meta_title, meta_description, keywords, canonical_url, og_title, og_description, og_image, header_scripts, footer_scripts } = body;

    if (!page_name) {
      return NextResponse.json({ success: false, message: 'Page name is required' }, { status: 400 });
    }

    const result = await db.query(
      `INSERT INTO seo_settings (page_name, meta_title, meta_description, keywords, canonical_url, og_title, og_description, og_image, header_scripts, footer_scripts) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [page_name, meta_title || '', meta_description || '', keywords || '', canonical_url || '', og_title || '', og_description || '', og_image || '', header_scripts || '', footer_scripts || '']
    );

    return NextResponse.json({ success: true, message: 'SEO setting created', data: { id: result.insertId } });
  } catch (error) {
    console.error('Error creating seo setting:', error);
    // Handle unique constraint error
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, message: 'SEO setting for this page name already exists' }, { status: 400 });
    }
    return NextResponse.json({ success: false, message: 'Failed to create seo setting' }, { status: 500 });
  }
}
