// app/api/payment/create-intent/route.js
// ✅ Sirf Stripe payment intent create karta hai
// Booking tab banegi jab payment/page.js mein payment success ho

import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import Stripe from 'stripe';
import { requireCaller } from '@/lib/api-auth';
import { catalogPrice } from '@/lib/booking-price';
import { loadPricing, priceJob, refusalOf } from '@/lib/pricing-rules';
import { paymentAmountCents } from '@/lib/booking-payment';

// Null without a key (as bookings/route.js and stripe/webhook/route.js build theirs): a missing key used to make this module throw
// while it loaded, so the guard below could never answer anyone in an environment without STRIPE_SECRET_KEY.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null;

export async function POST(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const body = await request.json();
    const { service_id } = body;

    // The caller is the account the intent is for: a body that names another account (user_id) or another account's
    // booking (booking_id) is a 403. The route reads neither otherwise, and no caller sends them.
    if (body.user_id !== undefined && body.user_id !== null && body.user_id !== '' && String(body.user_id) !== String(caller.id)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    if (body.booking_id) {
      const [named] = await execute('SELECT user_id FROM bookings WHERE id = ?', [body.booking_id]);
      if (named && String(named.user_id) !== String(caller.id)) {
        return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      }
    }

    // The amount is the price the service's pricing rule gives for the answers sent, worked out here. For repeating visits it
    // is the first visit's price, its frequency's discount included: the one hold of the series.
    const { service: serviceRow, items: pricingItems, discounts } = await loadPricing(execute, service_id);
    const job = priceJob(serviceRow, pricingItems, body.answers, discounts);
    if (!job.ok) {
      return NextResponse.json(refusalOf(job), { status: 400 });
    }
    const catalog = catalogPrice(serviceRow);

    // The bounds refusal comes before any Stripe work, so a price a card payment cannot take is a clean 400 even with no
    // key configured (the dev stack runs without one).
    const basePrice = job.price;
    const bounds = paymentAmountCents(basePrice);
    if (!bounds.ok) {
      return NextResponse.json({
        success: false,
        message: bounds.reason === 'below_minimum'
          ? 'The price for these answers is below the smallest amount a card payment can take'
          : 'The price for these answers is larger than a card payment can take',
        field: 'answers',
      }, { status: 400 });
    }

    // ── Check or Create Stripe Customer ──────────────────────────────────────────
    const users = await execute('SELECT id, email, first_name, last_name, stripe_customer_id FROM users WHERE id = ?', [caller.id]);
    if (!users || users.length === 0) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
    
    const user = users[0];
    if (!stripe) throw new Error('STRIPE_SECRET_KEY is not set');
    let stripeCustomerId = user.stripe_customer_id;

    if (!stripeCustomerId) {
      const customerName = `${user.first_name} ${user.last_name}`.trim();
      const customer = await stripe.customers.create({
        email: user.email,
        name: customerName,
        metadata: { user_id: user.id }
      });
      stripeCustomerId = customer.id;
      await execute('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [stripeCustomerId, user.id]);
    }

    const hourlyRate = catalog.rate;
    const maxOvertimeCost = 0; // Removed the 2hr hold as per new split payment logic
    const totalAmount = basePrice;
    const amountInCents = bounds.cents;

    // Service duration (metadata ke liye): the quoted minutes of these answers
    const standardDuration = job.minutes;

    // The card is held for the price and charged when the job is done. The card is saved on the customer so the booking
    // can be charged if the hold expires before then.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: process.env.STRIPE_CURRENCY || 'cad',
      customer: stripeCustomerId,
      description: `Authorization for: ${serviceRow.name || 'Service Booking'}`,
      capture_method: 'manual',
      setup_future_usage: 'off_session',
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'always'
      },
      metadata: {
        service_name: serviceRow.name || '',
        service_id: String(serviceRow.id || service_id || ''),
        quoted_price: basePrice.toFixed(2),
        base_price: basePrice.toFixed(2),
        overtime_rate: hourlyRate.toFixed(2),
        standard_duration: standardDuration.toString(),
        user_id: user.id.toString(),
      },
    });

    return NextResponse.json({
      success: true,
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: totalAmount,
    });

  } catch (error) {
    console.error('Error creating payment intent:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to initialize payment', error: error.message },
      { status: 500 }
    );
  }
}