import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  try {
    // Get all documents for this provider
    const documents = await execute(
      `SELECT id, provider_id, document_type, document_url, status, 
              rejection_reason, admin_notes, created_at, updated_at,
              is_verified
       FROM provider_documents 
       WHERE provider_id = ?
       ORDER BY 
         CASE document_type
           WHEN 'profile_photo' THEN 1
           WHEN 'id_proof' THEN 2
           WHEN 'insurance' THEN 3
           WHEN 'trade_license' THEN 4
           ELSE 5
         END,
         created_at DESC`,
      [providerId]
    );

    // Get provider info
    const providers = await execute(
      `SELECT id, name, email, phone, specialty, experience_years, city, bio,
              documents_uploaded, documents_verified, status, 
              stripe_onboarding_complete, onboarding_step
       FROM service_providers WHERE id = ?`,
      [providerId]
    );

    return NextResponse.json({
      success: true,
      documents: documents || [],
      provider: providers[0] || null,
      stats: {
        total: documents?.length || 0,
        pending: documents?.filter(d => d.status === 'pending').length || 0,
        approved: documents?.filter(d => d.status === 'approved').length || 0,
        rejected: documents?.filter(d => d.status === 'rejected').length || 0
      }
    });

  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}