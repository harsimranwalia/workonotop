// app/api/admin/providers/[providerId]/documents/route.js
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { requireCaller } from '@/lib/api-auth';

// ─── GET: provider info + all documents ──────────────────────────────────────
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { providerId } = await params;

    const providers = await execute(
      `SELECT id, name, email, phone, specialty, experience_years, city, bio,
              documents_uploaded, documents_verified, status, created_at,
              stripe_account_id, stripe_onboarding_complete
       FROM service_providers WHERE id = ?`,
      [providerId]
    );

    if (!providers || providers.length === 0) {
      return NextResponse.json({ success: false, message: 'Provider not found' }, { status: 404 });
    }

    const documents = await execute(
      `SELECT * FROM provider_documents WHERE provider_id = ? ORDER BY created_at DESC`,
      [providerId]
    );

    return NextResponse.json({
      success: true,
      provider: providers[0],
      documents: documents || [],
    });

  } catch (error) {
    console.error('❌ GET /documents error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ─── POST: approve_all | reject_all ──────────────────────────────────────────
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { providerId } = await params;
    const { action, rejectionReason } = await request.json();

    if (!providerId || !action) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    // ── approve_all ───────────────────────────────────────────────────────────
    // Called as part of approving a provider.
    // Sets all provider_documents → approved + is_verified=1
    // Sets service_providers → documents_verified=1
    if (action === 'approve_all') {
      await execute(
        `UPDATE provider_documents
         SET status = 'approved', is_verified = 1, reviewed_at = NOW()
         WHERE provider_id = ?`,
        [providerId]
      );

      await execute(
        `UPDATE service_providers
         SET documents_verified = 1, updated_at = NOW()
         WHERE id = ?`,
        [providerId]
      );

      return NextResponse.json({ success: true, message: 'All documents approved and verified' });
    }

    // ── reject_all ────────────────────────────────────────────────────────────
    // Rejects documents but keeps the account alive (status stays as-is).
    // Provider is redirected to re-upload on next login.
    // Schema: status enum = active|inactive|pending|rejected|suspended
    //   → We only touch documents_uploaded/documents_verified flags here.
    //   → Account status is NOT changed — provider stays 'inactive'/'pending'.
    if (action === 'reject_all') {
      if (!rejectionReason?.trim()) {
        return NextResponse.json({ success: false, message: 'Rejection reason is required' }, { status: 400 });
      }

      // Mark all pending docs as rejected with the reason
      await execute(
        `UPDATE provider_documents
         SET status = 'rejected',
             rejection_reason = ?,
             reviewed_at = NOW()
         WHERE provider_id = ? AND status = 'pending'`,
        [rejectionReason.trim(), providerId]
      );

      // Reset upload flags — forces provider back to step 2 on next login
      await execute(
        `UPDATE service_providers
         SET documents_uploaded = 0,
             documents_verified = 0,
             onboarding_completed = 0,
             onboarding_step = 3,
             updated_at = NOW()
         WHERE id = ?`,
        [providerId]
      );

      // Notify provider by email (non-blocking — DB already updated)
      try {
        const rows = await execute(
          `SELECT name, email FROM service_providers WHERE id = ?`,
          [providerId]
        );
        if (rows.length > 0) {
          await sendEmail({
            to: rows[0].email,
            subject: '⚠️ Action Required – Re-upload Your Documents on WorkOnTap',
            html: getDocumentRejectionEmailHtml(rows[0].name, rejectionReason.trim()),
          });
          console.log(`📧 Document rejection email sent to ${rows[0].email}`);
        }
      } catch (emailErr) {
        console.error('⚠️ Email failed (DB already updated):', emailErr.message);
      }

      return NextResponse.json({ success: true, message: 'Documents rejected and provider notified' });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('❌ POST /documents error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ─── Email template ───────────────────────────────────────────────────────────
function getDocumentRejectionEmailHtml(name, reason) {
  const reuploadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/provider/onboarding?step=2`;
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; background: #f9fafb; padding: 40px 20px; margin: 0;">
      <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="background: #dc2626; padding: 32px 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Documents Need Attention</h1>
          <p style="color: #fca5a5; margin: 8px 0 0; font-size: 14px;">WorkOnTap Provider Portal</p>
        </div>
        <div style="padding: 32px 24px;">
          <p style="color: #374151; font-size: 15px;">Hi <strong>${name}</strong>,</p>
          <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
            Our team reviewed your submitted documents and found an issue. Please re-upload the correct files to continue.
          </p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="color: #b91c1c; font-size: 13px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Reason</p>
            <p style="color: #dc2626; font-size: 14px; margin: 0; line-height: 1.6;">${reason}</p>
          </div>
          <a href="${reuploadUrl}"
             style="display: inline-block; background: #0f766e; color: white; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;">
            Re-upload Documents →
          </a>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f3f4f6; text-align: center;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            Questions? <a href="mailto:support@workontap.com" style="color: #0f766e;">support@workontap.com</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}