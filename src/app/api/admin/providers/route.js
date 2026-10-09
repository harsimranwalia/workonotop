



// // app/api/admin/providers/route.js
// import { NextResponse } from 'next/server';
// import { execute } from '@/lib/db';
// import { sendEmail, getApprovalEmailHtml, getRejectionEmailHtml } from '@/lib/email';

// export async function GET(request) {
//   try {
//     const { searchParams } = new URL(request.url);
//     const status = searchParams.get('status');
//     const search = searchParams.get('search');

//     // Main providers query with all data
//     let query = `
//       SELECT 
//         sp.*,
//         (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id) as documents_count,
//         (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id AND status = 'approved') as approved_docs,
//         (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id AND status = 'pending') as pending_docs,
//         (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id AND status = 'rejected') as rejected_docs,
//         (SELECT account_status FROM provider_bank_accounts WHERE provider_id = sp.id LIMIT 1) as bank_status
//       FROM service_providers sp
//       WHERE 1=1
//     `;

//     const params = [];

//     if (status && status !== 'all') {
//       if (status === 'pending') {
//         query += ` AND sp.status = 'inactive' AND sp.onboarding_completed = 1`;
//       } else {
//         query += ` AND sp.status = ?`;
//         params.push(status);
//       }
//     }

//     if (search) {
//       query += ` AND (sp.name LIKE ? OR sp.email LIKE ? OR sp.phone LIKE ?)`;
//       const searchTerm = `%${search}%`;
//       params.push(searchTerm, searchTerm, searchTerm);
//     }

//     query += ` ORDER BY sp.created_at DESC`;

//     const providers = await execute(query, params);

//     // Calculate stats
//     const stats = {
//       total: providers.length,
//       active: providers.filter(p => p.status === 'active').length,
//       pending: providers.filter(p => p.status === 'inactive' && p.onboarding_completed === 1).length,
//       rejected: providers.filter(p => p.status === 'rejected').length,
//       onboarding_completed: providers.filter(p => p.onboarding_completed === 1).length,
//       stripe_connected: providers.filter(p => p.stripe_account_id).length,
//       docs_verified: providers.filter(p => p.documents_verified === 1).length
//     };

//     return NextResponse.json({
//       success: true,
//       data: { providers, stats }
//     });

//   } catch (error) {
//     console.error('Error:', error);
//     return NextResponse.json(
//       { success: false, message: error.message },
//       { status: 500 }
//     );
//   }
// }

// export async function PUT(request) {
//   try {
//     const { providerId, action, rejectionReason } = await request.json();

//     // Get provider details for email
//     const provider = await execute(
//       `SELECT name, email FROM service_providers WHERE id = ?`,
//       [providerId]
//     );

//     if (!provider.length) {
//       return NextResponse.json(
//         { success: false, message: 'Provider not found' },
//         { status: 404 }
//       );
//     }

//     if (action === 'approve') {
//       // Approve provider
//       await execute(
//         `UPDATE service_providers 
//          SET status = 'active', approved_at = NOW(), updated_at = NOW() 
//          WHERE id = ?`,
//         [providerId]
//       );

//       // Send approval email
//       await sendEmail({
//         to: provider[0].email,
//         subject: '🎉 Congratulations! Your WorkOnTap Account is Approved',
//         html: getApprovalEmailHtml(provider[0].name)
//       });

//       console.log(`✅ Approval email sent to ${provider[0].email}`);

//     } else if (action === 'reject') {
//       // Reject provider
//       await execute(
//         `UPDATE service_providers 
//          SET status = 'rejected', rejection_reason = ?, updated_at = NOW() 
//          WHERE id = ?`,
//         [rejectionReason, providerId]
//       );

//       // Send rejection email with reason
//       await sendEmail({
//         to: provider[0].email,
//         subject: '📋 Update on Your WorkOnTap Application',
//         html: getRejectionEmailHtml(provider[0].name, rejectionReason)
//       });

//       console.log(`✅ Rejection email sent to ${provider[0].email} with reason: ${rejectionReason}`);
//     }

//     return NextResponse.json({ 
//       success: true,
//       message: `Provider ${action}ed successfully. Email sent.`
//     });

//   } catch (error) {
//     console.error('Error:', error);
//     return NextResponse.json(
//       { success: false, message: error.message },
//       { status: 500 }
//     );
//   }
// }
















// app/api/admin/providers/route.js - STABLE VERSION
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { sendEmail, getApprovalEmailHtml, getRejectionEmailHtml } from '@/lib/email';
import { logActivity } from '@/lib/logger';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    // Main providers query with all data
    let query = `
      SELECT 
        sp.*,
        (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id) as documents_count,
        (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id AND status = 'approved') as approved_docs,
        (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id AND status = 'pending') as pending_docs,
        (SELECT COUNT(*) FROM provider_documents WHERE provider_id = sp.id AND status = 'rejected') as rejected_docs,
        (SELECT account_status FROM provider_bank_accounts WHERE provider_id = sp.id LIMIT 1) as bank_status
      FROM service_providers sp
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'all') {
      query += ` AND sp.status = ?`;
      params.push(status);
    }

    if (search) {
      query += ` AND (sp.name LIKE ? OR sp.email LIKE ? OR sp.phone LIKE ? OR sp.specialty LIKE ? OR sp.city LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY sp.created_at DESC`;

    const providers = await execute(query, params);

    // Always fetch all for stats (unfiltered by status or search)
    const allProviders = (status && status !== 'all') || search
      ? await execute(`SELECT id, status, stripe_account_id, onboarding_completed, documents_verified FROM service_providers`, [])
      : providers;

    const stats = {
      total: allProviders.length,
      active: allProviders.filter(p => p.status === 'active').length,
      pending: allProviders.filter(p => p.status === 'pending').length,
      inactive: allProviders.filter(p => p.status === 'inactive').length,
      rejected: allProviders.filter(p => p.status === 'rejected').length,
      suspended: allProviders.filter(p => p.status === 'suspended').length,
      onboarding_completed: allProviders.filter(p => p.onboarding_completed === 1).length,
      stripe_connected: allProviders.filter(p => p.stripe_account_id).length,
      docs_verified: allProviders.filter(p => p.documents_verified === 1).length
    };

    return NextResponse.json({
      success: true,
      data: { providers, stats }
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { providerId, action, rejectionReason } = await request.json();

    console.log(`🔄 Processing ${action} for provider:`, providerId);

    // 🔴 STEP 1: Pehle DATABASE UPDATE karo (yeh hamesha hoga)
    if (action === 'approve') {
      // Approve provider
      await execute(
        `UPDATE service_providers 
         SET status = 'active', 
             onboarding_completed = 1,
             onboarding_step = 5,
             approved_at = NOW(), 
             updated_at = NOW() 
         WHERE id = ?`,
        [providerId]
      );
      console.log(`✅ Database updated: Provider ${providerId} approved`);

    } else if (action === 'reject') {
      // Reject provider
      await execute(
        `UPDATE service_providers 
         SET status = 'rejected', rejection_reason = ?, updated_at = NOW() 
         WHERE id = ?`,
        [rejectionReason, providerId]
      );
      console.log(`✅ Database updated: Provider ${providerId} rejected with reason: ${rejectionReason}`);
    }

    // 🔴 STEP 2: Email bhejo (agar fail hua to bhi database update rahega)
    try {
      const provider = await execute(
        `SELECT name, email FROM service_providers WHERE id = ?`,
        [providerId]
      );

      // Log Activity
      logActivity({
        actor_id: 1, // System/Admin ID (hardcoded 1 for admin or you can decode token to get admin ID)
        actor_type: 'admin',
        actor_name: 'Admin',
        action: action === 'approve' ? 'PROVIDER_APPROVED' : 'PROVIDER_REJECTED',
        entity_type: 'provider',
        entity_id: providerId,
        details: { provider_email: provider.length > 0 ? provider[0].email : 'unknown' }
      });

      if (provider.length > 0) {
        if (action === 'approve') {
          await sendEmail({
            to: provider[0].email,
            subject: '🎉 Congratulations! Your WorkOnTap Account is Approved',
            html: getApprovalEmailHtml(provider[0].name)
          });
          console.log(`📧 Approval email sent to ${provider[0].email}`);
        } else if (action === 'reject') {
          await sendEmail({
            to: provider[0].email,
            subject: '📋 Update on Your WorkOnTap Application',
            html: getRejectionEmailHtml(provider[0].name, rejectionReason)
          });
          console.log(`📧 Rejection email sent to ${provider[0].email}`);
        }
      }
    } catch (emailError) {
      // 🔴 Email fail hua to sirf log karo, database update already ho chuka hai
      console.error('⚠️ Email sending failed but database updated:', emailError.message);
    }

    // 🔴 STEP 3: Success response do (chahe email gayi ho ya nahi)
    return NextResponse.json({
      success: true,
      message: `Provider ${action}ed successfully. ${action === 'approve' ? 'Approved' : 'Rejected'}`
    });

  } catch (error) {
    console.error('❌ Database error:', error);
    return NextResponse.json(
      { success: false, message: 'Database error: ' + error.message },
      { status: 500 }
    );
  }
}