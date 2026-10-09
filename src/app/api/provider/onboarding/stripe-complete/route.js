import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';
import Stripe from 'stripe';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null;

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  try {
    console.log('='.repeat(60));
    console.log('🚀 STRIPE COMPLETE API CALLED');
    console.log('='.repeat(60));

    const body = await request.json();
    let accountId = body.accountId;

    // Fallback: If accountId not in body, try fetching from provider_bank_accounts
    if (!accountId) {
      const rows = await execute(
        'SELECT stripe_account_id FROM provider_bank_accounts WHERE provider_id = ?',
        [providerId]
      );
      accountId = rows[0]?.stripe_account_id;
    }

    if (!accountId) {
      console.log('❌ No stripe account found for provider:', providerId);
      return NextResponse.json(
        { success: false, message: 'Stripe account ID missing' },
        { status: 400 }
      );
    }

    let isComplete = false;
    try {
      if (!stripe) {
        throw new Error('Stripe is not initialized. Check STRIPE_SECRET_KEY.');
      }
      const account = await stripe.accounts.retrieve(accountId);

      console.log('📊 Stripe account status:', {
        id: account.id,
        details_submitted: account.details_submitted,
        charges_enabled: account.charges_enabled,
      });

      // Relaxation match with stripe-return logic
      isComplete = account.details_submitted && account.charges_enabled;
    } catch (stripeError) {
      console.error('❌ Stripe retrieve error:', stripeError.message);
      
      // Auto-recovery for orphaned test accounts when API keys are rotated
      if (
        stripeError.message.includes('does not have access to account') || 
        stripeError.message.includes('No such account') ||
        stripeError.code === 'resource_missing'
      ) {
        console.log(`🧹 Clearing invalid Stripe account ID ${accountId} from DB (stripe-complete)`);
        try {
          await execute(
            `UPDATE service_providers SET stripe_account_id = NULL, stripe_onboarding_complete = 0 WHERE id = ?`,
            [providerId]
          );
          await execute(
            `DELETE FROM provider_bank_accounts WHERE provider_id = ?`,
            [providerId]
          );
        } catch (dbError) {
          console.error('Failed to clear invalid Stripe account:', dbError);
        }
        
        return NextResponse.json(
          { success: false, message: 'Your Stripe connection is no longer valid. Please click Connect again.', clearAccount: true },
          { status: 400 }
        );
      }
      
      // Even if stripe fails for a different reason, we'll fall through
    }

    // 1. Update service_providers
    // Advance to step 4 (Review) which is the standard flow after Stripe
    await execute(
      `UPDATE service_providers 
       SET stripe_account_id = ?,
           stripe_onboarding_complete = ?,
           onboarding_step = 4,
           updated_at = NOW()
       WHERE id = ?`,
      [accountId, isComplete ? 1 : 0, providerId]
    );

    // 2. Update provider_bank_accounts (Sync with stripe-return logic)
    await execute(
      `INSERT INTO provider_bank_accounts 
       (provider_id, stripe_account_id, account_status, onboarding_completed, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         stripe_account_id = VALUES(stripe_account_id),
         account_status    = VALUES(account_status),
         onboarding_completed = VALUES(onboarding_completed),
         updated_at        = NOW()`,
      [
        providerId,
        accountId,
        isComplete ? 'verified' : 'pending',
        isComplete ? 1 : 0,
      ]
    );

    console.log(`✅ Stripe onboarding ${isComplete ? 'completed' : 'updated'} for provider:`, providerId);
    console.log('='.repeat(60));

    return NextResponse.json({
      success: true,
      message: isComplete ? 'Payment method connected successfully.' : 'Stripe account linked. Please complete verification steps.',
      isComplete: isComplete,
      step: 4
    });

  } catch (error) {
    console.error('❌ Error processing stripe completion:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}