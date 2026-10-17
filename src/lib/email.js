// lib/email.js - FIXED VERSION (Template same hai)
import nodemailer from 'nodemailer';

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  // nodemailer waits 2 minutes to connect, 30 seconds for the greeting and 10 minutes of silence by default, and a
  // notice's send waits with it; these are the longest a dead mail server may hold one send.
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
  },
});

export async function sendEmail({ to, subject, html, text }) {
  try {
    // Validate email configuration
    if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
      console.error('❌ SMTP_USER or EMAIL_USER not configured');
      return { success: false, error: 'Email configuration missing' };
    }

    if (!process.env.SMTP_PASS && !process.env.EMAIL_PASS) {
      console.error('❌ SMTP_PASS or EMAIL_PASS not configured');
      return { success: false, error: 'Email configuration missing' };
    }

    const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'WorkOnTap <noreply@workontap.com>';
    // The log carries no address, subject or error text: a recipient's address and the server's reason for refusing it
    // are personal data, and the logs outlive the message.
    console.log('[sendEmail] sending');

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
    });
    console.log('✅ Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[sendEmail] send failed:', typeof error?.code === 'string' ? error.code : 'unknown');
    return { success: false, error: error.message };
  }
}

// ─── Shared Layout Wrapper ────────────────────────────────────────────────────
function emailLayout({ previewText, headerBg, headerIcon, headerTitle, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${headerTitle}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">

  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}&nbsp;‌&nbsp;‌&nbsp;‌</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo Bar -->
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <span style="font-size:22px;font-weight:700;color:#0f766e;letter-spacing:-0.5px;">Work<span style="color:#0891b2;">On</span>Tap</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

              <!-- Header Banner -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${headerBg};padding:40px 32px;text-align:center;">
                    <div style="font-size:48px;margin-bottom:12px;">${headerIcon}</div>
                    <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.3px;">${headerTitle}</h1>
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:40px 40px 32px;">
                    ${body}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">© ${new Date().getFullYear()} WorkOnTap · Metro Vancouver, Canada</p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;">This email was sent to you because you have an account on WorkOnTap.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ─── Verification Email ───────────────────────────────────────────────────────
export function getVerificationEmailHtml(name, token) {
  // 🔴 FIX: Make sure URL is correct
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/provider/verify-email?token=${token}`;

  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${name} 👋</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      Welcome to <strong>WorkOnTap</strong>! You're just one step away from joining our network of skilled service providers.
      Please verify your email address to activate your account.
    </p>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td align="center">
          <a href="${verificationUrl}"
             style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#0f766e,#0891b2);color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
            ✉️ Verify My Email
          </a>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

    <!-- Info Box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">What happens next?</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">✅ Verify email → complete your profile</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">📄 Upload documents → bank setup</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">⏳ Admin review → get approved</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">🚀 Start accepting jobs!</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">Link expires in <strong>24 hours</strong>. If you didn't create this account, you can safely ignore this email.</p>
    <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">${verificationUrl}</p>
  `;

  return emailLayout({
    previewText: `Hi ${name}, verify your email to join WorkOnTap`,
    headerBg: 'linear-gradient(135deg, #0f766e 0%, #0891b2 100%)',
    headerIcon: '✉️',
    headerTitle: 'Verify Your Email',
    body,
  });
}

// ─── OTP Verification Email (Mobile) ──────────────────────────────────────────
export function getOtpVerificationEmailHtml(name, otp) {
  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${name} 👋</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      Welcome to <strong>WorkOnTap</strong>! Use the verification code below to complete your login or activation.
    </p>
    
    <!-- OTP Code Box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td align="center">
          <div style="padding:20px 40px;background:#f8fafc;border:2px dashed #0891b2;border-radius:12px;display:inline-block;">
            <span style="font-size:32px;font-weight:800;color:#0f766e;letter-spacing:8px;font-family:monospace;">${otp}</span>
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;font-size:14px;color:#64748b;text-align:center;">
      This code will expire in 15 minutes.
    </p>

    <!-- Divider -->
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

    <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">If you didn't request this, you can safely ignore this email.</p>
  `;

  return emailLayout({
    previewText: `Your WorkOnTap verification code: ${otp}`,
    headerBg: 'linear-gradient(135deg, #0f766e 0%, #0891b2 100%)',
    headerIcon: '🔐',
    headerTitle: 'Verification Code',
    body,
  });
}

// ─── Approval Email ───────────────────────────────────────────────────────────
export function getApprovalEmailHtml(name) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const dashboardUrl = `${baseUrl}/provider/dashboard`;

  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">Congratulations, ${name}! 🎉</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      Great news! Your WorkOnTap provider application has been <strong style="color:#16a34a;">approved</strong>.
      You can now log in and start accepting job requests from customers in your area.
    </p>

    <!-- Success Banner -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:linear-gradient(135deg,#dcfce7,#d1fae5);border:1px solid #86efac;border-radius:10px;padding:20px 24px;">
          <p style="margin:0;font-size:15px;font-weight:600;color:#15803d;">✅ Your account is now ACTIVE</p>
          <p style="margin:6px 0 0;font-size:14px;color:#166534;">You can start receiving job requests immediately.</p>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        <td align="center">
          <a href="${dashboardUrl}"
             style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            🚀 Go to My Dashboard
          </a>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

    <!-- Next Steps -->
    <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Here's what to do next</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;">
      <tr style="background:#f8fafc;">
        <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:20px;margin-right:12px;">📍</span>
          <span style="font-size:14px;color:#334155;">Confirm your <strong>service areas</strong> are up to date</span>
        </td>
      </tr>
      <tr style="background:#ffffff;">
        <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:20px;margin-right:12px;">🕐</span>
          <span style="font-size:14px;color:#334155;">Set your <strong>availability</strong> so customers can book you</span>
        </td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:20px;margin-right:12px;">👤</span>
          <span style="font-size:14px;color:#334155;">Complete your <strong>profile</strong> with a photo and bio</span>
        </td>
      </tr>
      <tr style="background:#ffffff;">
        <td style="padding:12px 16px;">
          <span style="font-size:20px;margin-right:12px;">💰</span>
          <span style="font-size:14px;color:#334155;">Start accepting <strong>job requests</strong> and earning</span>
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font-size:14px;color:#64748b;">
      Need help getting started? Reply to this email or contact us at
      <a href="mailto:support@workontap.com" style="color:#0891b2;text-decoration:none;">support@workontap.com</a>
    </p>
  `;

  return emailLayout({
    previewText: `Great news ${name}! Your WorkOnTap application has been approved 🎉`,
    headerBg: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)',
    headerIcon: '🎉',
    headerTitle: 'Application Approved!',
    body,
  });
}

// ─── Rejection Email ──────────────────────────────────────────────────────────
export function getRejectionEmailHtml(name, reason) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const reapplyUrl = `${baseUrl}/provider/signup`;
  const supportUrl = `mailto:support@workontap.com`;

  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${name},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      Thank you for your interest in joining WorkOnTap. After reviewing your application,
      we were unfortunately unable to approve your account at this time.
    </p>

    <!-- Reason Box -->
    ${reason ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:8px;padding:18px 20px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#9a3412;text-transform:uppercase;letter-spacing:0.5px;">Reason for rejection</p>
          <p style="margin:0;font-size:14px;color:#7c2d12;line-height:1.6;">${reason}</p>
        </td>
      </tr>
    </table>
    ` : ''}

    <!-- What to do -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">What you can do</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">📋 Review the reason above and address any issues</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">📄 Ensure all required documents are clear and valid</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">📧 Contact our support team if you have questions</p>
          <p style="margin:4px 0;font-size:14px;color:#475569;">🔄 Re-apply once the issues are resolved</p>
        </td>
      </tr>
    </table>

    <!-- CTA Buttons -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center" style="padding-bottom:12px;">
          <a href="${supportUrl}"
             style="display:inline-block;padding:12px 28px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;margin-right:8px;">
            📧 Contact Support
          </a>
          <a href="${reapplyUrl}"
             style="display:inline-block;padding:12px 28px;background:#475569;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            🔄 Re-Apply
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.7;">
      We appreciate your interest in WorkOnTap and encourage you to apply again once the above issues are resolved.
      Our team is happy to assist — just reply to this email.
    </p>
  `;

  return emailLayout({
    previewText: `Hi ${name}, an update on your WorkOnTap application`,
    headerBg: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
    headerIcon: '📋',
    headerTitle: 'Application Update',
    body,
  });
}

// ─── Data Deletion Request Emails ──────────────────────────────────────────────
export function getDeletionRequestReceivedEmailHtml(email) {
  const body = `
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0f172a;">Data Deletion Request Received</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      We have received your request to permanently delete your account and associated data for the email address: <strong>${email}</strong>.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#64748b;">
        Our team is currently reviewing your request. This process typically takes 3-5 business days. You will receive another email once the request has been processed.
      </p>
    </div>
    <p style="margin:0;font-size:14px;color:#64748b;">
      If you did not make this request, please contact us immediately at 
      <a href="mailto:support@workontap.com" style="color:#0891b2;text-decoration:none;">support@workontap.com</a>.
    </p>
  `;

  return emailLayout({
    previewText: `We've received your data deletion request for ${email}`,
    headerBg: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)',
    headerIcon: '🗑️',
    headerTitle: 'Request Received',
    body,
  });
}

export function getDeletionRequestProcessedEmailHtml(email) {
  const body = `
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0f172a;">Data Deletion Completed</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      Your request to delete data associated with <strong>${email}</strong> has been successfully processed.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#166534;">
        All your personal information, job history, and account settings have been permanently removed from our active systems.
      </p>
    </div>
    <p style="margin:0;font-size:14px;color:#64748b;">
      Thank you for being a part of WorkOnTap. If you change your mind, you are always welcome to create a new account in the future.
    </p>
  `;

  return emailLayout({
    previewText: `Your data deletion request for ${email} has been processed`,
    headerBg: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
    headerIcon: '✅',
    headerTitle: 'Deletion Processed',
    body,
  });
}

export function getDeletionRequestCancelledEmailHtml(email) {
  const body = `
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0f172a;">Data Deletion Request Cancelled</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      Your request to delete data associated with <strong>${email}</strong> has been cancelled.
    </p>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#9a3412;">
        Your account and data remain intact. If this was a mistake or you have questions about why the request was cancelled, please contact our support team.
      </p>
    </div>
    <p style="margin:0;font-size:14px;color:#64748b;">
      Contact support at <a href="mailto:support@workontap.com" style="color:#0891b2;text-decoration:none;">support@workontap.com</a>.
    </p>
  `;

  return emailLayout({
    previewText: `Your data deletion request for ${email} has been cancelled`,
    headerBg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
    headerIcon: '🚫',
    headerTitle: 'Request Cancelled',
    body,
  });
}

// ─── Admin Notification: New Provider Signup ─────────────────────────────────
export function getAdminNewProviderSignupEmailHtml(providerData) {
  const { name, email, phone } = providerData;
  const body = `
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0f172a;">New Provider Registered</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      A new service provider has just registered on WorkOnTap.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:4px 0;font-size:14px;color:#334155;"><strong>Name:</strong> ${name}</p>
      <p style="margin:4px 0;font-size:14px;color:#334155;"><strong>Email:</strong> ${email}</p>
      <p style="margin:4px 0;font-size:14px;color:#334155;"><strong>Phone:</strong> ${phone || 'Not provided'}</p>
    </div>
    <p style="margin:0;font-size:14px;color:#64748b;">
      Please review their application in the admin dashboard once they complete their profile.
    </p>
  `;

  return emailLayout({
    previewText: `New Provider: ${name} (${email})`,
    headerBg: 'linear-gradient(135deg, #0f766e 0%, #0891b2 100%)',
    headerIcon: '🆕',
    headerTitle: 'New Pro Signup',
    body,
  });
}

// ─── Welcome Email (kept for backward compat) ─────────────────────────────────
export function getWelcomeEmailHtml(name) {
  return getApprovalEmailHtml(name);
}

export function getAdminProviderApplicationSubmittedEmailHtml(providerData) {
  const { name, email, specialty } = providerData;
  const body = `
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0f172a;">Application Submitted for Review</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
      <strong>${name}</strong> has completed their profile and documents. Their application is now ready for your review.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:4px 0;font-size:14px;color:#334155;"><strong>Name:</strong> ${name}</p>
      <p style="margin:4px 0;font-size:14px;color:#334155;"><strong>Email:</strong> ${email}</p>
      <p style="margin:4px 0;font-size:14px;color:#334155;"><strong>Specialty:</strong> ${specialty || 'Not specified'}</p>
    </div>
    <p style="margin:0;font-size:14px;color:#64748b;">
      Login to the admin dashboard to verify their documents and activate their account.
    </p>
  `;

  return emailLayout({
    previewText: `Review Required: ${name} (${specialty})`,
    headerBg: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)',
    headerIcon: '📋',
    headerTitle: 'Application for Review',
    body,
  });
}