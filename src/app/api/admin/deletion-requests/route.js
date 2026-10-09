import { NextResponse } from 'next/server';
import { execute, query } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;
    const offset = (page - 1) * limit;

    const requests = await query(
      'SELECT * FROM deletion_requests ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    const [totalCount] = await query('SELECT COUNT(*) as count FROM deletion_requests');

    return NextResponse.json({
      success: true,
      data: requests,
      pagination: {
        total: totalCount.count,
        page,
        limit,
        totalPages: Math.ceil(totalCount.count / limit)
      }
    });

  } catch (error) {
    console.error('Admin Deletion Requests GET Error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id, status } = await request.json();

    if (!id || !status) {
      return NextResponse.json({ success: false, message: 'ID and Status are required' }, { status: 400 });
    }

    // Get the request details to get the email
    const [deletionReq] = await query('SELECT email FROM deletion_requests WHERE id = ?', [id]);
    if (!deletionReq) {
      return NextResponse.json({ success: false, message: 'Request not found' }, { status: 404 });
    }

    await execute(
      'UPDATE deletion_requests SET status = ? WHERE id = ?',
      [status, id]
    );

    // Send status update email
    try {
      const { sendEmail, getDeletionRequestProcessedEmailHtml, getDeletionRequestCancelledEmailHtml } = await import('@/lib/email');
      
      let html = '';
      let subject = '';
      
      if (status === 'processed') {
        subject = 'Data Deletion Request Processed - WorkOnTap';
        html = getDeletionRequestProcessedEmailHtml(deletionReq.email);
      } else if (status === 'cancelled') {
        subject = 'Data Deletion Request Update - WorkOnTap';
        html = getDeletionRequestCancelledEmailHtml(deletionReq.email);
      }

      if (html) {
        await sendEmail({
          to: deletionReq.email,
          subject,
          html
        });
      }
    } catch (emailError) {
      console.error('Failed to send status update email:', emailError);
    }

    return NextResponse.json({
      success: true,
      message: `Request for ${deletionReq.email} has been marked as ${status}. Confirmation email sent.`
    });

  } catch (error) {
    console.error('Admin Deletion Requests PATCH Error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
