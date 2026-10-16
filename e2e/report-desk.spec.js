// @ts-check
// The money half of the on-site reports (ENG-017): what the items an admin approves from a report cost (priceExtras,
// src/lib/pricing-rules.js), and the second charge for them (collectAddedItems, src/lib/booking-payment.js). Every case here
// imports the modules in this process; none opens a connection and none calls Stripe: the payment cases hand the module a
// scripted client that records every call and answers per a script (the precedent is e2e/booking-payment.spec.js).
import { test, expect } from '@playwright/test';

const { priceExtras } = await import('../src/lib/pricing-rules.js');
const { collectAddedItems, collectBookingPayment, ADDED_ITEMS_KEY } = await import('../src/lib/booking-payment.js');

// ── What the items cost: priceExtras ─────────────────────────────────────────────────────────────────────────────────
// A service whose catalogue holds the extras fridge at 25.00 (15 minutes, a quote from 6), oven at 40.00 (30 minutes, a quote
// from 3) and window at 10.00 (5 minutes, no quote), and a base of 120.00 that priceExtras never charges.
const SERVICE = { id: 1, name: 'Deep clean', base_price: '120.00', additional_price: '40.00', duration_minutes: 120, is_active: 1 };
const extra = (code, label, amount, minutes, quote_from = null) => ({ kind: 'extra', code, label, amount, minutes, quote_from });
const ITEMS = [
    extra('fridge', 'Fridge', '25.00', 15, 6),
    extra('oven', 'Oven', '40.00', 30, 3),
    extra('window', 'Window', '10.00', 5),
];
const ask = (code, quantity) => ({ code, quantity });

test.describe('priceExtras', () => {
    test('one fridge is priced at its own amount, in cents, with no base line', () => {
        const priced = priceExtras(SERVICE, ITEMS, [ask('fridge', 1)]);
        expect(priced.ok).toBe(true);
        expect(priced.cents).toBe(2500);
        expect(priced.minutes).toBe(15);
        expect(priced.lines.map((line) => line.kind)).toEqual(['extra']);
        expect(priced.lines[0]).toMatchObject({ kind: 'extra', code: 'fridge', label: 'Fridge', quantity: 1, amount: '25.00', minutes: 15 });
    });

    test('two items are summed in whole cents, and the minutes with them', () => {
        const priced = priceExtras(SERVICE, ITEMS, [ask('fridge', 2), ask('oven', 1)]);
        expect(priced).toMatchObject({ ok: true, cents: 9000, minutes: 60 });
        expect(priced.lines.map((line) => [line.code, line.quantity, line.amount])).toEqual([['fridge', 2, '50.00'], ['oven', 1, '40.00']]);
    });

    test('a quantity of 0 is valid and adds no line and no cents', () => {
        const priced = priceExtras(SERVICE, ITEMS, [ask('fridge', 2), ask('oven', 0)]);
        expect(priced).toMatchObject({ ok: true, cents: 5000 });
        expect(priced.lines.map((line) => line.code)).toEqual(['fridge']);
    });

    test('no extras at all is refused as extras: empty, missing, null, an object, a bare string', () => {
        for (const extras of [[], undefined, null, {}, 'fridge']) {
            expect(priceExtras(SERVICE, ITEMS, extras), JSON.stringify(extras) ?? 'undefined').toEqual({ ok: false, reason: 'extras' });
        }
    });

    test('an unknown code, a code twice, a quantity that is not a count, and only zeros are each refused as extras', () => {
        const refused = [
            [ask('nope', 1)],
            [ask('fridge', 1), ask('fridge', 1)],
            [ask('fridge', -1)],
            [ask('fridge', 1.5)],
            [ask('fridge', '2')],
            [ask('fridge', Number.NaN)],
            [ask('fridge', true)],
            [ask('fridge', 0)],
        ];
        for (const extras of refused) {
            expect(priceExtras(SERVICE, ITEMS, extras), JSON.stringify(extras)).toEqual({ ok: false, reason: 'extras' });
        }
    });

    test('a quantity at or above an item\'s quote_from is a quote and carries no cents', () => {
        const priced = priceExtras(SERVICE, ITEMS, [ask('oven', 3)]);
        expect(priced.ok).toBe(false);
        expect(priced.reason).toBe('quote');
        expect(priced.cents).toBeUndefined();
        expect(JSON.stringify(priced.flags)).toContain('oven');
        // One below the quote is priced; the item with no quote_from is never a quote.
        expect(priceExtras(SERVICE, ITEMS, [ask('oven', 2)])).toMatchObject({ ok: true, cents: 8000 });
        expect(priceExtras(SERVICE, ITEMS, [ask('window', 50)])).toMatchObject({ ok: true, cents: 50000 });
    });

    test('an extra worth 0.25 is priced: the payment bound is the payment module\'s, not this function\'s', () => {
        const dust = [extra('dust', 'Dust', '0.25', 1)];
        expect(priceExtras(SERVICE, dust, [ask('dust', 1)])).toMatchObject({ ok: true, cents: 25 });
    });

    test('the catalogue\'s own ceiling is too_large; a sum under it that a card could not take is priced', () => {
        expect(priceExtras(SERVICE, ITEMS, [ask('window', 10_000_000)])).toEqual({ ok: false, reason: 'too_large' });
        expect(priceExtras(SERVICE, ITEMS, [ask('window', 2_000_000)])).toMatchObject({ ok: true, cents: 2_000_000_000 });
    });

    test('a frequency or a discount handed in is ignored: the function has no parameter for either', () => {
        const same = priceExtras(SERVICE, ITEMS, [ask('fridge', 2), ask('oven', 1)]);
        // @ts-expect-error: extra arguments, on purpose
        const withMore = priceExtras(SERVICE, ITEMS, [ask('fridge', 2), ask('oven', 1)], { frequency: 'weekly' }, { weekly: 1000 });
        expect(withMore.cents).toBe(9000);
        expect(withMore).toEqual(same);
    });

    test('a service the catalogue does not offer, or one with no price, is refused as service', () => {
        expect(priceExtras({ ...SERVICE, base_price: '0.00' }, ITEMS, [ask('fridge', 1)])).toEqual({ ok: false, reason: 'service' });
        expect(priceExtras({ ...SERVICE, is_active: 0 }, ITEMS, [ask('fridge', 1)])).toEqual({ ok: false, reason: 'service' });
        expect(priceExtras(null, ITEMS, [ask('fridge', 1)])).toEqual({ ok: false, reason: 'service' });
    });

    test('amounts that float arithmetic adds inexactly are summed as cents: 0.10 and 0.20 make 30', () => {
        const tenth = [extra('a', 'A', '0.10', 1), extra('b', 'B', '0.20', 1)];
        const priced = priceExtras(SERVICE, tenth, [ask('a', 1), ask('b', 1)]);
        expect(priced.cents).toBe(30);
        expect(Number.isInteger(priced.cents)).toBe(true);
    });
});

// ── The second charge: collectAddedItems ─────────────────────────────────────────────────────────────────────────────
// A scripted Stripe client: each entry in `script` answers the next call to the named method, either a value, a function or an
// error; the last entry answers every call after it. Every call is recorded as [method, ...arguments].
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
        paymentIntents: { retrieve: wrap('retrieve'), capture: wrap('capture'), create: wrap('create'), confirm: wrap('confirm') },
        charges: { retrieve: wrap('charge') },
    };
}

const cardError = (code) => Object.assign(new Error('card error'), { type: 'StripeCardError', code });
const connError = () => Object.assign(new Error('connection'), { type: 'StripeConnectionError' });
const missingError = () => Object.assign(new Error('No such payment_intent'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });

const REPORT = { id: 7, booking_id: 42, cents: 5000, charge_intent_id: null };
const CARD = { customer: 'cus_1', payment_method: 'pm_1' };
const NAMED = { booking_id: '42', report_id: '7' };
const created = (over = {}) => ({ id: 'pi_extra_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: NAMED, ...over });
const paid = (over = {}) => created({ status: 'succeeded', amount_received: 5000, latest_charge: 'ch_extra_1', ...over });

// The callbacks a route hands over: the compare-and-set on the report's charge_intent_id and the read of it.
function onReport(start = null, { win = true, later = null } = {}) {
    const saves = [];
    return {
        saves,
        currency: 'cad',
        saveIntentId: async (newId, oldId) => { saves.push([newId, oldId]); return win; },
        readIntentId: async () => later ?? start,
    };
}

const only = (stripe, ...methods) => stripe.calls.filter(([method]) => methods.includes(method));

test.describe('collectAddedItems', () => {
    test('the key is the report\'s own and is not the booking\'s', () => {
        expect(ADDED_ITEMS_KEY(7)).toBe('report-7-added-items-charge');
        expect(ADDED_ITEMS_KEY(7)).not.toBe('booking-42-completion-charge');
    });

    test('an approved sum is charged on the card on file in an intent of its own, saved on the report before it is confirmed', async () => {
        const stripe = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid()] });
        const opts = onReport();
        const order = [];
        for (const method of ['create', 'confirm']) {
            const original = stripe.paymentIntents[method];
            stripe.paymentIntents[method] = async (...args) => { order.push(method); return original(...args); };
        }
        const save = opts.saveIntentId;
        opts.saveIntentId = async (...args) => { order.push('save'); return save(...args); };

        const result = await collectAddedItems(stripe, REPORT, { ...opts, card: CARD });

        expect(result).toEqual({ ok: true, chargeId: 'ch_extra_1', amountCents: 5000, overCollected: false });
        // One create, unconfirmed, for the approved cents, naming the booking and the report, under the report's key.
        expect(only(stripe, 'create')).toEqual([['create', {
            amount: 5000, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1',
            metadata: NAMED, confirm: false,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        }, { idempotencyKey: 'report-7-added-items-charge' }]]);
        // The compare-and-set is made on the report's old intent id (none yet), before the confirm.
        expect(opts.saves).toEqual([['pi_extra_1', null]]);
        expect(order).toEqual(['create', 'save', 'confirm']);
        // Off-session, on the saved card, and the answer is read from the intent afterwards.
        expect(only(stripe, 'confirm')).toEqual([['confirm', 'pi_extra_1', { payment_method: 'pm_1', off_session: true }]]);
        expect(stripe.calls.map(([method]) => method)).toEqual(['create', 'confirm', 'retrieve']);
        // Nothing here captures a held payment.
        expect(only(stripe, 'capture')).toEqual([]);
    });

    test('the currency the route passes is the currency charged, and cad when none is passed', async () => {
        const inUsd = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid()] });
        await collectAddedItems(inUsd, REPORT, { ...onReport(), currency: 'usd', card: CARD });
        expect(inUsd.calls[0][1].currency).toBe('usd');
        const inDefault = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid()] });
        const { saveIntentId, readIntentId } = onReport();
        await collectAddedItems(inDefault, REPORT, { saveIntentId, readIntentId, card: CARD });
        expect(inDefault.calls[0][1].currency).toBe('cad');
    });

    test('with no card link the card of the customer\'s checkout payment is used, and a lapsed hold is a card all the same', async () => {
        const checkout = { id: 'pi_checkout', status: 'canceled', cancellation_reason: 'automatic', customer: 'cus_9', payment_method: 'pm_9' };
        const stripe = scriptedClient({ retrieve: [checkout, paid()], create: [created({ payment_method: 'pm_9' })], confirm: [{}] });
        const result = await collectAddedItems(stripe, REPORT, { ...onReport(), cardIntentId: 'pi_checkout' });
        expect(result).toMatchObject({ ok: true, amountCents: 5000 });
        expect(stripe.calls.map(([method]) => method)).toEqual(['retrieve', 'create', 'confirm', 'retrieve']);
        expect(stripe.calls[0]).toEqual(['retrieve', 'pi_checkout']);
        expect(stripe.calls[1][1]).toMatchObject({ customer: 'cus_9', payment_method: 'pm_9', amount: 5000 });
    });

    test('the card link is used before the checkout payment, and is not read back from Stripe', async () => {
        const stripe = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid()] });
        await collectAddedItems(stripe, REPORT, { ...onReport(), card: CARD, cardIntentId: 'pi_checkout' });
        expect(stripe.calls.map(([method]) => method)).toEqual(['create', 'confirm', 'retrieve']);
        expect(only(stripe, 'retrieve').map((call) => call[1])).toEqual(['pi_extra_1']);
    });

    test('a customer with no card to charge is no_payment_method and nothing is created or confirmed', async () => {
        const none = scriptedClient({});
        expect(await collectAddedItems(none, REPORT, onReport())).toEqual({ ok: false, reason: 'no_payment_method' });
        expect(none.calls).toEqual([]);
        // A card link that names no customer or no card is no card; a checkout payment with no customer cannot be charged off-session.
        for (const card of [{ customer: 'cus_1' }, { payment_method: 'pm_1' }, { customer: null, payment_method: 'pm_1' }]) {
            const half = scriptedClient({});
            expect(await collectAddedItems(half, REPORT, { ...onReport(), card }), JSON.stringify(card)).toEqual({ ok: false, reason: 'no_payment_method' });
            expect(half.calls, JSON.stringify(card)).toEqual([]);
        }
        const cardless = scriptedClient({ retrieve: [{ id: 'pi_checkout', status: 'succeeded', customer: null }] });
        expect(await collectAddedItems(cardless, REPORT, { ...onReport(), cardIntentId: 'pi_checkout' })).toEqual({ ok: false, reason: 'no_payment_method' });
        expect(only(cardless, 'create', 'confirm')).toEqual([]);
        // A saved card whose payment method cannot be found is no card either.
        const lost = scriptedClient({ retrieve: [{ id: 'pi_checkout', status: 'succeeded', customer: 'cus_9', payment_method: null, latest_charge: null }] });
        expect(await collectAddedItems(lost, REPORT, { ...onReport(), cardIntentId: 'pi_checkout' })).toEqual({ ok: false, reason: 'no_payment_method' });
        expect(only(lost, 'create', 'confirm')).toEqual([]);
    });

    test('a checkout payment a person cancelled is not a card to charge', async () => {
        for (const reason of [null, 'abandoned', 'duplicate', 'fraudulent', 'requested_by_customer']) {
            const stripe = scriptedClient({ retrieve: [{ id: 'pi_checkout', status: 'canceled', cancellation_reason: reason, customer: 'cus_9', payment_method: 'pm_9' }] });
            expect(await collectAddedItems(stripe, REPORT, { ...onReport(), cardIntentId: 'pi_checkout' }), String(reason)).toEqual({ ok: false, reason: 'cancelled_by_person' });
            expect(only(stripe, 'create', 'confirm'), String(reason)).toEqual([]);
        }
    });

    test('a retry finds the intent saved on the report and confirms it again without creating another', async () => {
        const stripe = scriptedClient({ retrieve: [created(), paid()], confirm: [{}] });
        const result = await collectAddedItems(stripe, { ...REPORT, charge_intent_id: 'pi_extra_1' }, { ...onReport('pi_extra_1'), card: CARD });
        expect(result).toEqual({ ok: true, chargeId: 'ch_extra_1', amountCents: 5000, overCollected: false });
        expect(only(stripe, 'create')).toEqual([]);
        expect(only(stripe, 'confirm')).toEqual([['confirm', 'pi_extra_1', { payment_method: 'pm_1', off_session: true }]]);
        // A charge already taken is carried on, with no second confirm; one waiting on the customer is reported; one in flight is not known yet.
        const taken = scriptedClient({ retrieve: [paid()] });
        expect(await collectAddedItems(taken, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toMatchObject({ ok: true, chargeId: 'ch_extra_1' });
        expect(only(taken, 'create', 'confirm')).toEqual([]);
        const waiting = scriptedClient({ retrieve: [created({ status: 'requires_action' })] });
        expect(await collectAddedItems(waiting, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toEqual({ ok: false, reason: 'action_required' });
        const inFlight = scriptedClient({ retrieve: [created({ status: 'processing' })] });
        expect(await collectAddedItems(inFlight, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toEqual({ ok: false, reason: 'unavailable' });
        expect(only(waiting, 'create', 'confirm').concat(only(inFlight, 'create', 'confirm'))).toEqual([]);
    });

    test('an intent cancelled elsewhere is a mismatch and nothing is created over it', async () => {
        for (const status of ['canceled', 'requires_capture']) {
            const stripe = scriptedClient({ retrieve: [created({ status })] });
            expect(await collectAddedItems(stripe, { ...REPORT, charge_intent_id: 'pi_extra_1' }, { ...onReport('pi_extra_1'), card: CARD }), status).toEqual({ ok: false, reason: 'mismatch' });
            expect(only(stripe, 'create', 'confirm', 'capture'), status).toEqual([]);
        }
    });

    test('only an intent made for this report is confirmed: another report\'s, or one that names none, is a mismatch', async () => {
        for (const metadata of [{ booking_id: '42', report_id: '8' }, { booking_id: '42' }, {}, undefined]) {
            const stripe = scriptedClient({ retrieve: [created({ metadata })], confirm: [{}] });
            expect(await collectAddedItems(stripe, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1')), JSON.stringify(metadata)).toEqual({ ok: false, reason: 'mismatch' });
            expect(only(stripe, 'confirm', 'create'), JSON.stringify(metadata)).toEqual([]);
        }
        // A booking's own completion charge names no report, so it is never confirmed as an added-items charge.
        const booking = scriptedClient({ retrieve: [created({ metadata: { booking_id: '42' } })], confirm: [{}] });
        expect(await collectAddedItems(booking, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toEqual({ ok: false, reason: 'mismatch' });
    });

    test('a crash between the save and the confirm leaves the intent on the report, and the retry continues that one', async () => {
        const first = scriptedClient({ create: [created()], confirm: [connError()], retrieve: [created()] });
        const opts = onReport();
        expect(await collectAddedItems(first, REPORT, { ...opts, card: CARD })).toEqual({ ok: false, reason: 'unavailable' });
        expect(opts.saves).toEqual([['pi_extra_1', null]]);
        // The retry is handed what the first try saved.
        const retry = scriptedClient({ retrieve: [created(), paid()], confirm: [{}] });
        const result = await collectAddedItems(retry, { ...REPORT, charge_intent_id: opts.saves[0][0] }, { ...onReport(opts.saves[0][0]), card: CARD });
        expect(result).toMatchObject({ ok: true, chargeId: 'ch_extra_1' });
        expect(only(retry, 'create')).toEqual([]);
        expect(only(retry, 'confirm').map((call) => call[1])).toEqual(['pi_extra_1']);
    });

    test('a declined card is declined, one that needs the customer is action required, and both leave the intent to retry', async () => {
        const declined = scriptedClient({ create: [created()], confirm: [cardError('card_declined')], retrieve: [created({ status: 'requires_payment_method', payment_method: null })] });
        expect(await collectAddedItems(declined, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'declined' });
        const needsAction = scriptedClient({ create: [created()], confirm: [cardError('authentication_required')], retrieve: [created({ status: 'requires_action' })] });
        expect(await collectAddedItems(needsAction, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'action_required' });
        // A confirm that returns with the charge not taken is read from the intent.
        for (const [status, reason] of [['requires_action', 'action_required'], ['requires_payment_method', 'declined']]) {
            const unsettled = scriptedClient({ create: [created()], confirm: [{}], retrieve: [created({ status })] });
            expect(await collectAddedItems(unsettled, REPORT, { ...onReport(), card: CARD }), status).toEqual({ ok: false, reason });
        }
        // A declined retry continues the same intent: one create across both tries.
        const again = scriptedClient({ retrieve: [created({ status: 'requires_payment_method' }), paid()], confirm: [{}] });
        expect(await collectAddedItems(again, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toMatchObject({ ok: true });
        expect(only(again, 'create')).toEqual([]);
    });

    test('an error that is not the card\'s is a mismatch, and Stripe out of reach leaves the report to a later try', async () => {
        const unknown = scriptedClient({ create: [missingError()] });
        const opts = onReport();
        expect(await collectAddedItems(unknown, REPORT, { ...opts, card: CARD })).toEqual({ ok: false, reason: 'mismatch' });
        expect(opts.saves).toEqual([]);
        expect(only(unknown, 'confirm')).toEqual([]);
        const away = scriptedClient({ create: [connError()] });
        expect(await collectAddedItems(away, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'unavailable' });
        const unreadable = scriptedClient({ retrieve: [connError()] });
        expect(await collectAddedItems(unreadable, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toEqual({ ok: false, reason: 'unavailable' });
        const unknownSaved = scriptedClient({ retrieve: [missingError()] });
        expect(await collectAddedItems(unknownSaved, { ...REPORT, charge_intent_id: 'pi_extra_1' }, onReport('pi_extra_1'))).toEqual({ ok: false, reason: 'mismatch' });
    });

    test('when another try saved its intent first, this one continues that one and confirms none of its own', async () => {
        const theirs = created({ id: 'pi_theirs' });
        const stripe = scriptedClient({ create: [created()], retrieve: [theirs, paid({ id: 'pi_theirs' })], confirm: [{}] });
        const opts = onReport(null, { win: false, later: 'pi_theirs' });
        const result = await collectAddedItems(stripe, REPORT, { ...opts, card: CARD });
        expect(result).toMatchObject({ ok: true, chargeId: 'ch_extra_1' });
        expect(opts.saves).toEqual([['pi_extra_1', null]]);
        expect(only(stripe, 'confirm')).toEqual([['confirm', 'pi_theirs', { payment_method: 'pm_1', off_session: true }]]);
        // If the report cannot say which intent is the saved one, nothing is confirmed and the answer is unavailable.
        for (const later of [null, undefined]) {
            const unsure = scriptedClient({ create: [created()], confirm: [{}] });
            expect(await collectAddedItems(unsure, REPORT, { ...onReport(null, { win: false, later }), card: CARD })).toEqual({ ok: false, reason: 'unavailable' });
            expect(only(unsure, 'confirm'), String(later)).toEqual([]);
        }
    });

    test('a sum that is not whole cents inside the payment bounds is a mismatch and nothing is called', async () => {
        for (const cents of [49, 0, -5000, 100_000_000, 12.5, null, undefined, '5000', Number.NaN]) {
            const stripe = scriptedClient({});
            expect(await collectAddedItems(stripe, { ...REPORT, cents }, { ...onReport(), card: CARD }), String(cents)).toEqual({ ok: false, reason: 'mismatch' });
            expect(stripe.calls, String(cents)).toEqual([]);
        }
        // The bounds themselves are charged.
        for (const cents of [50, 99_999_999]) {
            const stripe = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid({ amount_received: cents })] });
            expect(await collectAddedItems(stripe, { ...REPORT, cents }, { ...onReport(), card: CARD }), String(cents)).toMatchObject({ ok: true, amountCents: cents });
            expect(stripe.calls[0][1].amount, String(cents)).toBe(cents);
        }
    });

    test('a charge that took less than the approved sum is a mismatch with nothing to pay from, and one that took more is carried on', async () => {
        const short = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid({ amount_received: 4999 })] });
        expect(await collectAddedItems(short, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'mismatch' });
        const noCharge = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid({ latest_charge: null })] });
        expect(await collectAddedItems(noCharge, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'mismatch' });
        const over = scriptedClient({ create: [created()], confirm: [{}], retrieve: [paid({ amount_received: 5500 })] });
        expect(await collectAddedItems(over, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: true, chargeId: 'ch_extra_1', amountCents: 5500, overCollected: true });
    });

    test('with no payment client nothing is called and the answer is not configured', async () => {
        expect(await collectAddedItems(null, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'not_configured' });
        expect(await collectAddedItems(undefined, REPORT, { ...onReport(), card: CARD })).toEqual({ ok: false, reason: 'not_configured' });
    });

    test('a booking\'s own completion charge is made with the booking\'s own key and the booking\'s own metadata', async () => {
        const lapsed = { id: 'pi_hold_1', status: 'canceled', cancellation_reason: 'automatic', customer: 'cus_1', payment_method: 'pm_1', latest_charge: 'ch_1', metadata: {} };
        const make = () => scriptedClient({
            retrieve: [lapsed, { id: 'pi_new_1', status: 'succeeded', amount_received: 13500, latest_charge: 'ch_9' }],
            create: [{ id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } }],
            confirm: [{}],
        });
        const booking = { id: 42, service_price: '135.00', payment_intent_id: 'pi_hold_1' };
        const stripe = make();
        const result = await collectBookingPayment(stripe, booking, { currency: 'cad', saveIntentId: async () => true, readIntentId: async () => 'pi_hold_1' });
        expect(result).toMatchObject({ ok: true, chargeId: 'ch_9' });
        expect(only(stripe, 'create')).toEqual([['create', {
            amount: 13500, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1',
            metadata: { booking_id: '42' }, confirm: false,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        }, { idempotencyKey: 'booking-42-completion-charge' }]]);
        // The two paths differ in their key and their metadata and in nothing else: the same create, field for field.
        const extras = scriptedClient({ create: [created({ metadata: NAMED })], confirm: [{}], retrieve: [paid()] });
        await collectAddedItems(extras, { id: 7, booking_id: 42, cents: 13500, charge_intent_id: null }, { ...onReport(), card: CARD });
        const [, bookingArgs, bookingOptions] = only(stripe, 'create')[0];
        const [, extraArgs, extraOptions] = only(extras, 'create')[0];
        expect({ ...extraArgs, metadata: bookingArgs.metadata }).toEqual(bookingArgs);
        expect(extraArgs.metadata).toEqual({ booking_id: '42', report_id: '7' });
        expect(bookingOptions).toEqual({ idempotencyKey: 'booking-42-completion-charge' });
        expect(extraOptions).toEqual({ idempotencyKey: 'report-7-added-items-charge' });
    });
});
