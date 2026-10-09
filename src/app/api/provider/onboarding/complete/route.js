import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';
import { sendEmail, getAdminProviderApplicationSubmittedEmailHtml } from '@/lib/email';

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  try {
    console.log('='.repeat(60));
    console.log('🚀 ONBOARDING COMPLETE API CALLED');
    console.log('='.repeat(60));

    console.log('✅ Provider ID:', providerId);

    // First, check if documents are uploaded and stripe is complete
    const providerData = await execute(
      `SELECT 
        (SELECT COUNT(*) FROM provider_documents WHERE provider_id = ?) as docs_count,
        stripe_onboarding_complete
       FROM service_providers WHERE id = ?`,
      [providerId, providerId]
    );

    const docsCount = providerData[0]?.docs_count || 0;
    const stripeComplete = providerData[0]?.stripe_onboarding_complete === 1;

    console.log('📊 Stats:', { docsCount, stripeComplete });


    // Update provider
    await execute(
      `UPDATE service_providers 
       SET 
           onboarding_completed = 1,
           onboarding_step = 5,
           status = IF(status = 'active', 'active', 'pending'),
           updated_at = NOW()
       WHERE id = ?`,
      [providerId]
    );

    // Get updated status for response
    const provider = await execute(
      `SELECT status FROM service_providers WHERE id = ?`,
      [providerId]
    );
    const newStatus = provider[0]?.status || 'pending';

    console.log('✅ Onboarding completed for provider:', providerId);
    console.log('='.repeat(60));

    // 🔔 Notify Admin about application ready for review
    try {
      const providerInfo = await execute(
        `SELECT name, email, specialty FROM service_providers WHERE id = ?`,
        [providerId]
      );
      if (providerInfo.length > 0) {
        const { name: fullName, email, specialty } = providerInfo[0];
        const adminEmail = process.env.ADMIN_EMAIL || 'amandeepkumar.flymediatech@gmail.com';
        
        try {
          sendEmail({
            to: adminEmail,
            subject: `Review Required: ${fullName}`,
            html: getAdminProviderApplicationSubmittedEmailHtml({ name: fullName, email, specialty }),
            text: `Professional application submitted: ${fullName} (${email}, Specialty: ${specialty || 'None'})`
          }).then(() => {
            console.log('✅ Admin notification sent (Application Review) to:', adminEmail);
          }).catch((err) => {
            console.error('❌ Admin notification error:', err.message);
          });
        } catch (err) {
          console.error('❌ Admin notification setup error:', err.message);
        }
      }
    } catch (adminEmailError) {
      console.error('❌ Admin notification setup error:', adminEmailError.message);
    }

    return NextResponse.json({
      success: true,
      message: newStatus === 'active' ? 'Profile updated successfully.' : 'Onboarding completed. Your application is under review.',
      status: newStatus
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}