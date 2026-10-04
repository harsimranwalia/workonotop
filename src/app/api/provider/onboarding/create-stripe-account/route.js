import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', { apiVersion: '2026-05-27.dahlia' });

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  console.log('\n' + '='.repeat(80));
  console.log('🚀 CREATE STRIPE ACCOUNT CALLED');
  console.log('='.repeat(80));

  try {
    const body = await request.json();

    // ✅ FIX: Use environment variable for URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    const refreshUrl =
      body.refreshUrl ||
      `${baseUrl}/provider/onboarding?step=3`;
    const returnUrl =
      body.returnUrl ||
      `${baseUrl}/api/provider/onboarding/stripe-return`;

    // Get provider details
    const providers = await execute(
      `SELECT email, name, phone, city, location FROM service_providers WHERE id = ?`,
      [providerId]
    );

    if (providers.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Provider not found' },
        { status: 404 }
      );
    }

    const provider = providers[0];

    // Check for existing Stripe account
    const existingAccounts = await execute(
      'SELECT stripe_account_id FROM provider_bank_accounts WHERE provider_id = ?',
      [providerId]
    );

    if (existingAccounts.length > 0 && existingAccounts[0].stripe_account_id) {
      try {
        const account = await stripe.accounts.retrieve(
          existingAccounts[0].stripe_account_id
        );
        const accountLink = await stripe.accountLinks.create({
          account: account.id,
          refresh_url: refreshUrl,
          return_url: returnUrl,
          type: 'account_onboarding',
        });
        console.log('✅ Reusing existing Stripe account:', account.id);
        return NextResponse.json({
          success: true,
          accountId: account.id,
          onboardingUrl: accountLink.url,
        });
      } catch (stripeError) {
        console.error('Error retrieving existing account:', stripeError.message);
        // Fall through to create a new account
      }
    }

    // Create new Stripe Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: process.env.STRIPE_COUNTRY || 'CA',
      email: provider.email,
      business_type: 'individual',
      business_profile: {
        name: provider.name,
        product_description: 'Home services provider',
        mcc: '1520',
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        provider_id: providerId.toString(),
        environment: process.env.NODE_ENV || 'development',
      },
    });

    console.log('✅ Stripe account created:', account.id);

    // Save stripe_account_id to service_providers
    await execute(
      `UPDATE service_providers 
       SET stripe_account_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [account.id, providerId]
    );

    // Insert or update into provider_bank_accounts
    await execute(
      `INSERT INTO provider_bank_accounts 
       (provider_id, stripe_account_id, account_status, onboarding_completed, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
       stripe_account_id = VALUES(stripe_account_id),
       account_status = VALUES(account_status),
       onboarding_completed = VALUES(onboarding_completed),
       updated_at = NOW()`,
      [providerId, account.id]
    );

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return NextResponse.json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url,
    });
  } catch (error) {
    console.error('❌ Stripe account creation error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}







