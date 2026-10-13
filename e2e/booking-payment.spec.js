// @ts-check
// The payment of a booking: the amounts a card payment can take, the payment bound to the booking at the checkout, and the
// one charge when the job is done. Thirty-two cases, each titled for what it shows. C1 to C29 import the module
// (src/lib/booking-payment.js) in this process and drive it with a scripted client that records every call and answers per
// a script (the precedent is e2e/price-of-record.spec.js); C30 to C32 go through the dev app. The dev stack holds no payment
// key, so the dev app books unverified (recorded pending, no held amount); the verified path is the scripted client's and,
// later, a run with test keys.
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';

const {
    paymentAmountCents,
    paymentCheckMode,
    checkHeldPayment,
    collectBookingPayment,
} = await import('../src/lib/booking-payment.js');

// A scripted Stripe client: each entry in `script` answers the next call to the named method, either a value or an error.
// Every call is recorded as [method, id, params, options].
function scriptedClient(script = {}) {
    const calls = [];
    const wrap = (method) => async (...args) => {
        calls.push([method, ...args]);
        const queue = script[method] || [];
        const step = queue.length > 1 ? queue.shift() : queue[0];
        if (step === undefined) throw new Error(`scripted client: no answer scripted for ${method}`);
        if (step instanceof Error) throw step;
        return typeof step === 'function' ? step(...args) : step;
    };
    return {
        calls,
        paymentIntents: {
            retrieve: wrap('retrieve'),
            capture: wrap('capture'),
            create: wrap('create'),
            confirm: wrap('confirm'),
        },
        charges: {
            retrieve: wrap('charge'),
        },
    };
}

const cardError = (code) => Object.assign(new Error('card error'), { type: 'StripeCardError', code });
const connError = () => Object.assign(new Error('connection'), { type: 'StripeConnectionError' });

const BOOKING = { id: 42, service_price: '135.00', payment_intent_id: 'pi_hold_1' };
const EXPECTED = 13500;
const OPTS = {
    currency: 'cad',
    saveIntentId: async () => true,
    readIntentId: async () => 'pi_hold_1',
};

function heldIntent(over = {}) {
    return {
        id: 'pi_hold_1', status: 'requires_capture', capture_method: 'manual',
        amount: EXPECTED, amount_capturable: EXPECTED, currency: 'cad', customer: 'cus_1',
        latest_charge: 'ch_1', payment_method: 'pm_1', metadata: {}, ...over,
    };
}

const NOW = 1_760_000_000;

test.describe('Booking payment', () => {
    test('the smallest price a card payment takes is 0.50, and 0.49 is refused', () => {
        expect(paymentAmountCents(0.50)).toEqual({ ok: true, cents: 50 });
        expect(paymentAmountCents(0.49)).toEqual({ ok: false, reason: 'below_minimum' });
    });

    test('a by-the-hour price that rounds to 0.45 is refused as below the card minimum', () => {
        expect(paymentAmountCents(0.45)).toEqual({ ok: false, reason: 'below_minimum' });
    });

    test('999,999.99 is taken and 1,000,000.00 is refused as larger than a card payment can take', () => {
        expect(paymentAmountCents(999999.99)).toEqual({ ok: true, cents: 99999999 });
        expect(paymentAmountCents(1000000.00)).toEqual({ ok: false, reason: 'too_large' });
    });

    test('without a payment key, production refuses a booking and other environments book it unverified', () => {
        expect(paymentCheckMode({ hasKey: false, nodeEnv: 'production' })).toBe('refuse');
        expect(paymentCheckMode({ hasKey: false, nodeEnv: 'development' })).toBe('unverified');
        expect(paymentCheckMode({ hasKey: true, nodeEnv: 'production' })).toBe('verify');
        expect(paymentCheckMode({ hasKey: true, nodeEnv: 'development' })).toBe('verify');
    });

    test('a hold of the booking price for the booking account is accepted as authorized at the held amount', () => {
        const check = checkHeldPayment(heldIntent(), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: true, paymentStatus: 'authorized', authorizedCents: EXPECTED });
    });

    test('a hold one cent away from the booking price is refused as a changed price', () => {
        const check = checkHeldPayment(heldIntent({ amount: EXPECTED - 1, amount_capturable: EXPECTED - 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check.ok).toBe(false);
        expect(check.status).toBe(409);
        expect(check.message).toBe('The price of this booking has changed since the card was authorized. Please confirm the booking again.');
        // One cent above the price is a changed price too: the hold is for exactly this booking's price.
        const above = checkHeldPayment(heldIntent({ amount: EXPECTED + 1, amount_capturable: EXPECTED + 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(above.ok).toBe(false);
        expect(above.status).toBe(409);
    });

    test('a hold for another account gets the general refusal even when its amount also differs', () => {
        const check = checkHeldPayment(heldIntent({ customer: 'cus_other', amount: 1, amount_capturable: 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
        // No account to compare with is the same refusal, whatever the intent says.
        const none = checkHeldPayment(heldIntent({ customer: undefined }), { amountCents: EXPECTED, currency: 'cad', customerId: undefined, nowSeconds: NOW });
        expect(none).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
    });

    test('a hold in another currency is refused', () => {
        const check = checkHeldPayment(heldIntent({ currency: 'usd' }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
        // The configured currency is compared without regard to case: Stripe writes it in lower case.
        expect(checkHeldPayment(heldIntent(), { amountCents: EXPECTED, currency: 'CAD', customerId: 'cus_1', nowSeconds: NOW }).ok).toBe(true);
    });

    test('a hold whose capturable amount is below its amount is refused', () => {
        const check = checkHeldPayment(heldIntent({ amount_capturable: EXPECTED - 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
    });

    test('an intent that is not a hold (needs a payment method, cancelled, processing) is refused', () => {
        for (const status of ['requires_payment_method', 'canceled', 'processing']) {
            const check = checkHeldPayment(heldIntent({ status }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
            expect(check.ok, `status ${status}`).toBe(false);
        }
    });

    test('a payment taken by automatic capture in the last day is accepted as paid when it received the booking price', () => {
        const intent = heldIntent({ status: 'succeeded', capture_method: 'automatic', amount_received: EXPECTED, created: NOW - 3600 });
        const check = checkHeldPayment(intent, { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: true, paymentStatus: 'paid', authorizedCents: EXPECTED });
        // Received one cent either side of the booking price is a changed price.
        for (const received of [EXPECTED - 1, EXPECTED + 1]) {
            const off = checkHeldPayment({ ...intent, amount_received: received }, { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
            expect(off.ok, `received ${received}`).toBe(false);
            expect(off.status, `received ${received}`).toBe(409);
        }
    });

    test('a taken payment older than a day, or one made with manual capture, is refused', () => {
        const old = checkHeldPayment(heldIntent({ status: 'succeeded', capture_method: 'automatic', amount_received: EXPECTED, created: NOW - 90000 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(old.ok).toBe(false);
        const manual = checkHeldPayment(heldIntent({ status: 'succeeded', capture_method: 'manual', amount_received: EXPECTED, created: NOW - 60 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(manual.ok).toBe(false);
    });

    test('a held card is captured once for the recorded price with the booking key, and the charge id is returned', async () => {
        const stripe = scriptedClient({
            retrieve: [heldIntent(), heldIntent({ status: 'succeeded', amount_received: EXPECTED })],
            capture: [{}],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls).toEqual([
            ['retrieve', 'pi_hold_1'],
            ['capture', 'pi_hold_1', { amount_to_capture: EXPECTED }, { idempotencyKey: 'booking-42-capture' }],
            ['retrieve', 'pi_hold_1'],
        ]);
    });

    test('a hold larger than the recorded price is captured for the recorded price', async () => {
        const stripe = scriptedClient({
            retrieve: [heldIntent({ amount: 20000, amount_capturable: 20000 }), heldIntent({ status: 'succeeded', amount_received: EXPECTED })],
            capture: [{}],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result.ok).toBe(true);
        expect(stripe.calls[1]).toEqual(['capture', 'pi_hold_1', { amount_to_capture: EXPECTED }, { idempotencyKey: 'booking-42-capture' }]);
    });

    test('a hold smaller than the recorded price is not captured and is reported as a mismatch', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ amount: 10000, amount_capturable: 10000 })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'mismatch' });
        expect(stripe.calls.filter(([m]) => m === 'capture')).toEqual([]);
    });

    test('a payment already taken for the recorded price is carried on with no second capture', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls).toEqual([['retrieve', 'pi_hold_1']]);
    });

    test('a payment taken for less than the recorded price is a mismatch with nothing to pay from', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED - 1 })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'mismatch' });
        // A payment that names no charge has nothing to tie a payout to, and a booking with no recorded price has nothing to take.
        const noCharge = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED, latest_charge: null })] });
        expect(await collectBookingPayment(noCharge, BOOKING, OPTS)).toEqual({ ok: false, reason: 'mismatch' });
        const noPrice = scriptedClient({ retrieve: [heldIntent()] });
        expect(await collectBookingPayment(noPrice, { ...BOOKING, service_price: null }, OPTS)).toEqual({ ok: false, reason: 'mismatch' });
        expect(noPrice.calls).toEqual([]);
    });

    test('a payment taken for more than the recorded price is carried on and marked over-collected', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED + 500 })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED + 500, overCollected: true });
    });

    test('a hold Stripe let lapse is charged on the saved card for the recorded price, saved on the booking before it is confirmed', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            create: [created],
            confirm: [{}],
        });
        const saved = [];
        const result = await collectBookingPayment(stripe, BOOKING, {
            ...OPTS,
            saveIntentId: async (newId, oldId) => { saved.push([newId, oldId]); return true; },
        });
        expect(result).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        // The create carries the recorded price, the saved card and the per-booking key, unconfirmed.
        expect(stripe.calls[1]).toEqual(['create', {
            amount: EXPECTED, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1',
            metadata: { booking_id: '42' }, confirm: false,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        }, { idempotencyKey: 'booking-42-completion-charge' }]);
        // Saved on the booking before it is confirmed.
        expect(saved).toEqual([['pi_new_1', 'pi_hold_1']]);
        expect(stripe.calls[2][0]).toBe('confirm');
    });

    test('a lapsed hold with no payment method of its own uses the payment method of its latest charge', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'expired', payment_method: null, latest_charge: { id: 'ch_1', payment_method: 'pm_from_charge' } });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_from_charge', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            create: [created],
            confirm: [{}],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result.ok).toBe(true);
        expect(stripe.calls[1][1].payment_method).toBe('pm_from_charge');

        // The charge arrives as its id, as the API returns it: it is read, and its payment method is the card charged.
        const byId = scriptedClient({
            retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'expired', payment_method: null, latest_charge: 'ch_1' }), { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            charge: [{ id: 'ch_1', payment_method: 'pm_from_charge' }],
            create: [created],
            confirm: [{}],
        });
        const result2 = await collectBookingPayment(byId, BOOKING, OPTS);
        expect(result2.ok).toBe(true);
        expect(byId.calls.map(([method]) => method)).toEqual(['retrieve', 'charge', 'create', 'confirm', 'retrieve']);
        expect(byId.calls[1]).toEqual(['charge', 'ch_1']);
        expect(byId.calls[2][1].payment_method).toBe('pm_from_charge');
    });

    test('a lapsed hold with no saved card is reported and no charge is attempted', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic', payment_method: null, latest_charge: null });
        const stripe = scriptedClient({ retrieve: [lapsed] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'no_payment_method' });
        expect(stripe.calls.filter(([m]) => m === 'create')).toEqual([]);
    });

    test('a hold a person cancelled is never charged again', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'abandoned' })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'cancelled_by_person' });
        expect(stripe.calls.filter(([m]) => m === 'create' || m === 'confirm')).toEqual([]);
    });

    test('a declined saved-card charge is reported as declined, and one that needs the customer as action required', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const declined = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'requires_payment_method', payment_method: null }],
            create: [created],
            confirm: [cardError('card_declined')],
        });
        const result = await collectBookingPayment(declined, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'declined' });

        const needsAction = scriptedClient({
            retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'automatic' }), { ...created, status: 'requires_action' }],
            create: [created],
            confirm: [cardError('authentication_required')],
        });
        const result2 = await collectBookingPayment(needsAction, BOOKING, OPTS);
        expect(result2).toEqual({ ok: false, reason: 'action_required' });
    });

    test('a retry finds the saved charge waiting for confirmation and confirms it without creating another', async () => {
        const savedCharge = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [savedCharge, { ...savedCharge, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            confirm: [{}],
        });
        const result = await collectBookingPayment(stripe, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls.filter(([m]) => m === 'create')).toEqual([]);
        expect(stripe.calls.filter(([m]) => m === 'confirm')).toEqual([['confirm', 'pi_new_1', { payment_method: 'pm_1', off_session: true }]]);
    });

    test('a retry finds the saved charge taken and carries on without charging again', async () => {
        const savedCharge = { id: 'pi_new_1', status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({ retrieve: [savedCharge] });
        const result = await collectBookingPayment(stripe, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls.filter(([m]) => m === 'create' || m === 'confirm' || m === 'capture')).toEqual([]);
    });

    test('when another call saved its charge first, this call continues with that one', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const mine = { id: 'pi_mine', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const theirs = { id: 'pi_theirs', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [lapsed, theirs, { ...theirs, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_theirs' }],
            create: [mine],
            confirm: [{}],
        });
        // The booking holds the lapsed hold when this call starts; when its own save loses, the booking holds the other call's charge.
        const reads = ['pi_hold_1', 'pi_theirs'];
        const result = await collectBookingPayment(stripe, BOOKING, {
            ...OPTS,
            saveIntentId: async () => false,
            readIntentId: async () => reads.shift(),
        });
        expect(result).toEqual({ ok: true, chargeId: 'ch_theirs', amountCents: EXPECTED, overCollected: false });
        // Only the charge on the booking is confirmed; the one this call created is left unconfirmed.
        expect(stripe.calls.filter(([m]) => m === 'confirm')).toEqual([['confirm', 'pi_theirs', { payment_method: 'pm_1', off_session: true }]]);

        // A save that loses with nothing else on the booking confirms nothing.
        const alone = scriptedClient({ retrieve: [lapsed], create: [mine], confirm: [{}] });
        const result2 = await collectBookingPayment(alone, BOOKING, { ...OPTS, saveIntentId: async () => false, readIntentId: async () => 'pi_hold_1' });
        expect(result2).toEqual({ ok: false, reason: 'unavailable' });
        expect(alone.calls.filter(([m]) => m === 'confirm')).toEqual([]);
    });

    test('a capture error is settled by reading the intent again, not by the error text', async () => {
        const stripe = scriptedClient({
            retrieve: [heldIntent(), heldIntent({ status: 'succeeded', amount_received: EXPECTED })],
            capture: [Object.assign(new Error('You cannot capture this PaymentIntent because it has a status of succeeded'), { statusCode: 400 })],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });
    });

    test('Stripe out of reach leaves the booking untouched for a later try', async () => {
        const stripe = scriptedClient({ retrieve: [connError()] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'unavailable' });
    });

    test('with no payment client nothing is called and the answer is not configured', async () => {
        const result = await collectBookingPayment(null, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'not_configured' });
    });

    // ── Through the dev app (no payment key: bookings are recorded pending, unverified) ─────────────────────────────

    const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const bookingBody = (fields = {}) => {
        const t = tag();
        return {
            service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
            first_name: 'E2E', last_name: 'Payment', email: `e2e-eng008-${t}@workontap.test`, phone: '+14035550199',
            job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E booking-payment case, deleted by the case.',
            address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_eng008_${t}`,
            ...fields,
        };
    };

    test('a booking made where no payment key is set is recorded as pending with no held amount', async ({ request, baseURL }) => {
        const styles = await getCredentialHeaders(String(baseURL));
        const body = bookingBody();
        const created = await request.post('/api/bookings', { data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(created.status(), 'checkout makes the booking').toBe(200);
        const answer = await created.json();
        expect(answer.authorized_amount, 'the answer holds no held amount').toBeNull();
        expect(answer.message, 'the answer says the payment was not verified').toBe('Booking confirmed. Payment was not verified: payments are not configured on this server.');
        const read = await request.get(`/api/bookings/${answer.booking_id}`, { headers: styles['admin-bearer'] });
        const row = (await read.json()).data;
        expect(row.payment_status, 'the stored payment status').toBe('pending');
        expect(row.authorized_amount, 'the stored held amount is null').toBeNull();
        await request.delete(`/api/bookings?id=${answer.booking_id}`, { headers: styles['admin-bearer'] });
    });

    test('a booking and create-intent refuse a price below the card minimum with the same answer', async ({ request, baseURL }) => {
        const styles = await getCredentialHeaders(String(baseURL));
        // Fixture service 1's 'hourly' option is 45.00 by the hour, so one hundredth of an hour prices at 0.45. The date is
        // a Monday: a weekend date would add the weekend line and the price would clear the card minimum.
        const answers = { option: 'hourly', hours: 0.01 };
        const intent = await request.post('/api/payment/create-intent', { headers: styles['customer-bearer'], data: { service_id: 1, answers } });
        expect(intent.status(), 'create-intent refuses the price').toBe(400);
        const intentBody = await intent.json();
        expect(intentBody).toEqual({ success: false, message: 'The price for these answers is below the smallest amount a card payment can take', field: 'answers' });

        const booking = await request.post('/api/bookings', { data: bookingBody({ answers, job_date: '2026-02-02' }), maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(booking.status(), 'the booking refuses the price').toBe(400);
        expect(await booking.json()).toEqual({ success: false, message: 'The price for these answers is below the smallest amount a card payment can take', field: 'answers' });
    });

    test('a payment already attached to a booking is refused with 409', async ({ request, baseURL }) => {
        const styles = await getCredentialHeaders(String(baseURL));
        const body = bookingBody();
        const created = await request.post('/api/bookings', { data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(created.status(), 'the first booking is made').toBe(200);
        const first = await created.json();
        try {
            const again = await request.post('/api/bookings', { data: bookingBody({ payment_intent_id: body.payment_intent_id }), maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect(again.status(), 'the same payment id is refused').toBe(409);
            expect(await again.json()).toEqual({ success: false, message: 'This payment is already attached to a booking.' });
        } finally {
            await request.delete(`/api/bookings?id=${first.booking_id}`, { headers: styles['admin-bearer'] });
        }
    });
});
