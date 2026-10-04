// database/fixtures/bookings.js
// Two finished jobs, one per customer and provider pair, and the invoice, payout and review row each one left behind, so a
// test that crosses accounts has another account's row to ask for. Plain data with no imports. The identity rules in
// accounts.js bind this set too: customer_email is the customer's own @workontap.test address, names and phones are
// the fixture accounts', addresses are invented, and every timestamp is FIXED_AT or a fixed time, so two loads
// write the same bytes.
//
//   booking 1  customer 1 (user 1)  with provider 1   BK-FIXTURE-0001   invoice 1, payout 1, review 1
//   booking 2  customer 2 (user 2)  with provider 2   BK-FIXTURE-0002   invoice 2, payout 2, review 2
//
// Why invoices and payouts: the admin finance routes read them (admin/earnings: bookings LEFT JOIN invoices, then
// invoices; admin/invoices: invoices; admin/payouts: provider_payouts joined to bookings), so an admin sees a row of
// each. GET /api/reviews reads provider_reviews joined to users, service_providers, bookings and services, and a
// customer's list is the reviews of their own bookings (the booking's user_id), so each booking has one review, written by
// the booking's own customer (provider_reviews.booking_id is unique). The booking numbers, addresses, descriptions and review
// texts are distinct per account so that a test can assert by absence: customer 1's answer holds none of customer 2's strings.
//
// Money follows the catalogue: service 1 (Fixture Standard Clean) is 80.00 with 40.00 an hour of overtime, and the
// commission is the 20 percent of system_settings.default_commission, so the provider's share is 64.00. The payout is
// `pending` with no Stripe ids: no Stripe account exists in this environment (accounts.js).
//
// Order: this set needs users, service_providers and services, so it is listed after accounts and catalog.

const FIXED_AT = '2026-01-01 00:00:00';
const JOB_DATE = '2026-01-15';
const STARTED_AT = '2026-01-15 09:00:00';
const ENDED_AT = '2026-01-15 11:00:00';
const REVIEWED_AT = '2026-01-16 10:00:00';

const SERVICE_NAME = 'Fixture Standard Clean';
const PRICE = 80.0;
const COMMISSION_PERCENT = 20.0;
const COMMISSION = 16.0;
const PROVIDER_AMOUNT = 64.0;

const booking = ({ id, userId, providerId, number, first, last, email, phone, address, description }) => ({
  id,
  user_id: userId,
  booking_number: number,
  service_id: 1,
  provider_id: providerId,
  service_name: SERVICE_NAME,
  service_price: PRICE,
  additional_price: 40.0,
  standard_duration_minutes: 120,
  customer_first_name: first,
  customer_last_name: last,
  customer_email: email,
  customer_phone: phone,
  job_date: JOB_DATE,
  job_time_slot: '09:00',
  worker_count: 1,
  job_description: description,
  address_line1: address,
  city: 'Calgary',
  status: 'completed',
  commission_percent: COMMISSION_PERCENT,
  provider_amount: PROVIDER_AMOUNT,
  accepted_at: STARTED_AT,
  start_time: STARTED_AT,
  end_time: ENDED_AT,
  actual_duration_minutes: 120,
  overtime_minutes: 0,
  overtime_earnings: 0.0,
  final_provider_amount: PROVIDER_AMOUNT,
  job_timer_status: 'completed',
  before_photos_uploaded: 0,
  after_photos_uploaded: 0,
  payment_status: 'paid',
  payment_method: 'card',
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
});

const invoice = ({ id, number, bookingId, userId, providerId }) => ({
  id,
  invoice_number: number,
  booking_id: bookingId,
  user_id: userId,
  provider_id: providerId,
  invoice_type: 'customer',
  base_amount: PRICE,
  commission_percent: COMMISSION_PERCENT,
  commission_amount: COMMISSION,
  overtime_minutes: 0,
  overtime_rate: 40.0,
  overtime_amount: 0.0,
  total_amount: PRICE,
  provider_earnings: PROVIDER_AMOUNT,
  service_name: SERVICE_NAME,
  service_duration: 120,
  actual_duration: 120,
  job_date: JOB_DATE,
  completion_date: ENDED_AT,
  status: 'paid',
  payment_method: 'card',
  payment_date: ENDED_AT,
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
  final_provider_amount: PROVIDER_AMOUNT,
  overtime_earnings: 0.0,
  job_timer_status: 'completed',
  start_time: STARTED_AT,
  end_time: ENDED_AT,
});

const payout = ({ id, providerId, bookingId }) => ({
  id,
  provider_id: providerId,
  amount: PROVIDER_AMOUNT,
  status: 'pending',
  stripe_payout_id: null,
  stripe_transfer_id: null,
  booking_id: bookingId,
  notes: 'Fixture payout, not sent anywhere.',
  created_at: FIXED_AT,
  paid_at: null,
  updated_at: FIXED_AT,
});

// One review per booking (provider_reviews.booking_id is unique), written by the booking's own customer for its own provider.
const review = ({ id, bookingId, providerId, customerId, rating, text }) => ({
  id,
  booking_id: bookingId,
  provider_id: providerId,
  customer_id: customerId,
  rating,
  review: text,
  is_anonymous: 0,
  created_at: REVIEWED_AT,
  updated_at: REVIEWED_AT,
});

export const bookings = {
  name: 'bookings',
  tables: {
    bookings: [
      booking({
        id: 1,
        userId: 1,
        providerId: 1,
        number: 'BK-FIXTURE-0001',
        first: 'Fixture',
        last: 'Customer One',
        email: 'fixture-customer-1@workontap.test',
        phone: '+14035550101',
        address: '101 Fixture Street',
        description: 'Fixture booking one: a standard clean for Fixture Customer One.',
      }),
      booking({
        id: 2,
        userId: 2,
        providerId: 2,
        number: 'BK-FIXTURE-0002',
        first: 'Fixture',
        last: 'Customer Two',
        email: 'fixture-customer-2@workontap.test',
        phone: '+14035550102',
        address: '202 Fixture Avenue',
        description: 'Fixture booking two: a standard clean for Fixture Customer Two.',
      }),
    ],
    invoices: [
      invoice({ id: 1, number: 'INV-FIXTURE-0001', bookingId: 1, userId: 1, providerId: 1 }),
      invoice({ id: 2, number: 'INV-FIXTURE-0002', bookingId: 2, userId: 2, providerId: 2 }),
    ],
    provider_payouts: [payout({ id: 1, providerId: 1, bookingId: 1 }), payout({ id: 2, providerId: 2, bookingId: 2 })],
    provider_reviews: [
      review({ id: 1, bookingId: 1, providerId: 1, customerId: 1, rating: 5, text: 'Fixture review one: Fixture Customer One found the clean thorough and on time.' }),
      review({ id: 2, bookingId: 2, providerId: 2, customerId: 2, rating: 4, text: 'Fixture review two: Fixture Customer Two found the clean tidy and friendly.' }),
    ],
  },
};
