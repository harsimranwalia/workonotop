import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const rows = await db.query('SELECT * FROM seo_settings WHERE id = ?', [id]);

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, message: 'SEO setting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching seo setting:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch seo setting' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { page_name, meta_title, meta_description, keywords, canonical_url, og_title, og_description, og_image, header_scripts, footer_scripts } = body;

    if (!page_name) {
      return NextResponse.json({ success: false, message: 'Page name is required' }, { status: 400 });
    }

    await db.query(
      `UPDATE seo_settings 
       SET page_name = ?, meta_title = ?, meta_description = ?, keywords = ?, canonical_url = ?, og_title = ?, og_description = ?, og_image = ?, header_scripts = ?, footer_scripts = ?
       WHERE id = ?`,
      [page_name, meta_title || '', meta_description || '', keywords || '', canonical_url || '', og_title || '', og_description || '', og_image || '', header_scripts || '', footer_scripts || '', id]
    );

    return NextResponse.json({ success: true, message: 'SEO setting updated' });
  } catch (error) {
    console.error('Error updating seo setting:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, message: 'SEO setting for this page name already exists' }, { status: 400 });
    }
    return NextResponse.json({ success: false, message: 'Failed to update seo setting' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    await db.query('DELETE FROM seo_settings WHERE id = ?', [id]);
    return NextResponse.json({ success: true, message: 'SEO setting deleted' });
  } catch (error) {
    console.error('Error deleting seo setting:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete seo setting' }, { status: 500 });
  }
}
