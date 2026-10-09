// app/api/payment/create-intent/route.js
// ✅ Sirf Stripe payment intent create karta hai
// Booking tab banegi jab payment/page.js mein payment success ho

import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import Stripe from 'stripe';
import { requireCaller } from '@/lib/api-auth';
import { catalogPrice } from '@/lib/booking-price';

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

    // The amount is the catalog's price of the service named by service_id, read here.
    const [serviceRow] = service_id
      ? await execute('SELECT name, base_price, additional_price, duration_minutes, is_active FROM services WHERE id = ?', [service_id])
      : [];
    const catalog = catalogPrice(serviceRow);
    if (!catalog) {
      return NextResponse.json({ success: false, message: 'This service is not available for booking' }, { status: 400 });
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

    const basePrice = catalog.price;
    const hourlyRate = catalog.rate;
    const maxOvertimeCost = 0; // Removed the 2hr hold as per new split payment logic
    const totalAmount = basePrice;
    const amountInCents = Math.round(totalAmount * 100);

    // Service duration (metadata ke liye)
    const standardDuration = serviceRow.duration_minutes || 60;

    // ✅ capture_method: automatic — charge immediately
    // 💳 setup_future_usage: 'off_session' — Save the card on the customer for later payments
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: process.env.STRIPE_CURRENCY || 'cad', 
      customer: stripeCustomerId,
      description: `Authorization for: ${serviceRow.name || 'Service Booking'}`,
      setup_future_usage: 'off_session',
      automatic_payment_methods: { 
        enabled: true,
        allow_redirects: 'always' 
      },
      metadata: {
        service_name: serviceRow.name || '',
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