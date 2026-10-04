// // app/api/admin/providers/approve/route.js
// import { NextResponse } from 'next/server';
// import { execute, getConnection, withConnection } from '@/lib/db';
// import { verifyToken } from '@/lib/jwt';
// import { sendEmail } from '@/lib/email';

// // Update the PUT method in your existing admin/providers/route.js

// export async function PUT(request) {
//   // single connection for the whole handler
//   return await withConnection(async (connection) => {
//     try {
//       const { providerId, action, rejectionReason } = await request.json();

//       await connection.beginTransaction();

//       if (action === 'approve') {
//         // Update provider status to active
//         await connection.execute(
//           `UPDATE service_providers 
//            SET status = 'active', 
//                approved_at = NOW(),
//                updated_at = NOW()
//            WHERE id = ?`,
//           [providerId]
//         );

//         console.log('✅ Provider approved:', providerId);

//         // Get provider details for email
//         const providers = await connection.execute(
//           'SELECT name, email FROM service_providers WHERE id = ?',
//           [providerId]
//         );
        
//         if (providers.length > 0) {
//           const provider = providers[0];
          
//           // Create notification in database
//           await connection.execute(
//             `INSERT INTO provider_notifications 
//              (provider_id, type, title, message, data) 
//              VALUES (?, 'account_approved', 'Account Approved!', 
//                      'Congratulations! Your account has been approved. You can now start accepting jobs.', ?)`,
//             [providerId, JSON.stringify({ approved: true })]
//           );

//           // Try to send email (don't fail if it doesn't work)
//           try {
//             await sendEmail({
//               to: provider.email,
//               subject: 'Welcome to WorkOnTap - Account Approved!',
//               html: getWelcomeEmailHtml(provider.name)
//             });
//           } catch (emailError) {
//             console.error('Welcome email failed:', emailError);
//           }
//         }

//       } else if (action === 'reject') {
//         await connection.execute(
//           `UPDATE service_providers 
//            SET status = 'suspended',
//                rejection_reason = ?,
//                updated_at = NOW()
//            WHERE id = ?`,
//           [rejectionReason, providerId]
//         );
        
//         console.log('❌ Provider rejected:', providerId);
//       }

//       await connection.commit();

//       return NextResponse.json({
//         success: true,
//         message: `Provider ${action}ed successfully`
//       });
//     } catch (error) {
//       await connection.rollback();
//       console.error('Provider update error:', error);
//       return NextResponse.json(
//         { success: false, message: error.message },
//         { status: 500 }
//       );
//     }
//   });
// }






























// app/api/admin/providers/route.js  (PUT only — add to your existing file)
import { NextResponse } from 'next/server';
import { execute, withConnection } from '@/lib/db';
import { sendEmail, getApprovalEmailHtml, getRejectionEmailHtml } from '@/lib/email';
import { notifyUser } from '@/lib/push';
import { requireCaller } from '@/lib/api-auth';

// ─── Schema reference ─────────────────────────────────────────────────────────
// service_providers.status  enum('active','inactive','pending','rejected','suspended')
// service_providers.documents_verified   tinyint(1)
// service_providers.documents_uploaded   tinyint(1)
// service_providers.approved_at          datetime
// service_providers.approved_by          int
// service_providers.rejection_reason     text

export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  return await withConnection(async (connection) => {
    try {
      const { providerId, action, rejectionReason } = await request.json();

      if (!providerId || !action) {
        return NextResponse.json({ success: false, message: 'Missing providerId or action' }, { status: 400 });
      }

      await connection.beginTransaction();

      // ── APPROVE ─────────────────────────────────────────────────────────────
      // Sets status='active', approved_at=NOW()
      // NOTE: documents are verified separately via POST /documents { action:'approve_all' }
      if (action === 'approve') {
        await connection.execute(
          `UPDATE service_providers
           SET status       = 'active',
               email_verified = 1,
               email_verification_token = NULL,
               email_verification_expires = NULL,
               approved_at  = NOW(),
               updated_at   = NOW()
           WHERE id = ?`,
          [providerId]
        );

        // Notify via email
        const [rows] = await connection.execute(
          `SELECT name, email FROM service_providers WHERE id = ?`,
          [providerId]
        );
        if (rows.length > 0) {
          // Notification row
          try {
            await connection.execute(
              `INSERT INTO notifications (user_id, user_type, type, title, message, data)
               VALUES (?, 'provider', 'account_approved', 'Account Approved!',
                       'Congratulations! Your account has been approved. You can now start accepting jobs.',
                       ?)`,
              [providerId, JSON.stringify({ approved: true })]
            );
          } catch (notifErr) {
            console.warn('⚠️ notifications insert skipped:', notifErr.message);
          }

          try {
            await sendEmail({
              to: rows[0].email,
              subject: '🎉 Welcome to WorkOnTap – Account Approved!',
              html: getApprovalEmailHtml(rows[0].name),
            });
            console.log(`📧 Approval email sent to ${rows[0].email}`);
          } catch (emailErr) {
            console.error('⚠️ Approval email failed:', emailErr.message);
          }
        }

        await connection.commit();

        // 🔔 Push notification to provider (non-blocking)
        try {
          notifyUser(
            providerId,
            '🎉 Account Approved!',
            'Congratulations! Your WorkOnTap account is approved. You can now start accepting jobs.',
            { type: 'account_approved' },
            execute,
            'provider'
          ).catch(e => console.warn('[Push] provider approval notify error:', e.message));
        } catch (_) {}

        return NextResponse.json({ success: true, message: 'Provider approved successfully' });
      }

      // ── REJECT PROVIDER (suspend account) ───────────────────────────────────
      // Sets status='suspended' (valid enum value), stores rejection_reason.
      // Provider is blocked from logging in and receives a rejection email.
      if (action === 'reject') {
        if (!rejectionReason?.trim()) {
          await connection.rollback();
          return NextResponse.json({ success: false, message: 'Rejection reason is required' }, { status: 400 });
        }

        await connection.execute(
          `UPDATE service_providers
           SET status           = 'suspended',
               rejection_reason = ?,
               updated_at       = NOW()
           WHERE id = ?`,
          [rejectionReason.trim(), providerId]
        );

        // Send rejection email
        const [rows] = await connection.execute(
          `SELECT name, email FROM service_providers WHERE id = ?`,
          [providerId]
        );
        if (rows.length > 0) {
          try {
            await sendEmail({
              to: rows[0].email,
              subject: 'Update on your WorkOnTap application',
              html: getRejectionEmailHtml(rows[0].name, rejectionReason.trim()),
            });
            console.log(`📧 Rejection email sent to ${rows[0].email}`);
          } catch (emailErr) {
            console.error('⚠️ Rejection email failed:', emailErr.message);
          }
        }

        await connection.commit();

        // 🔔 Push notification to provider (non-blocking)
        try {
          notifyUser(
            providerId,
            '❌ Application Update',
            `Your WorkOnTap application was not approved. Reason: ${rejectionReason.trim()}`,
            { type: 'account_rejected' },
            execute,
            'provider'
          ).catch(e => console.warn('[Push] provider rejection notify error:', e.message));
        } catch (_) {}

        return NextResponse.json({ success: true, message: 'Provider rejected and suspended' });
      }

      // ── SUSPEND (manual admin action) ────────────────────────────────────────
      if (action === 'suspend') {
        await connection.execute(
          `UPDATE service_providers
           SET status     = 'suspended',
               updated_at = NOW()
           WHERE id = ?`,
          [providerId]
        );
        await connection.commit();
        return NextResponse.json({ success: true, message: 'Provider suspended' });
      }

      // ── REACTIVATE ────────────────────────────────────────────────────────────
      if (action === 'reactivate') {
        await connection.execute(
          `UPDATE service_providers
           SET status     = 'active',
               updated_at = NOW()
           WHERE id = ?`,
          [providerId]
        );
        await connection.commit();
        return NextResponse.json({ success: true, message: 'Provider reactivated' });
      }

      await connection.rollback();
      return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });

    } catch (error) {
      await connection.rollback();
      console.error('❌ PUT /api/admin/providers error:', error);
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
  });
}