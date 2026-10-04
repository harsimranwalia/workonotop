// database/fixtures/ownership.js
// Rows the cross-account cases of e2e/ownership.spec.js (ENG-023) need and the other sets do not write, so a case that asks
// for another account's data has something of that account's to leave out. Plain data with no imports. The identity rules in
// accounts.js bind this set too: the text is invented, the names are the fixture accounts', and every timestamp is a fixed
// time, so two loads write the same bytes.
//
// chat_messages (the table the four /api/chat routes read and write; nothing else does). Each fixture booking has a message
// from its customer and a reply from its provider, unread both ways, with strings no other row has:
//
//   chat 1  booking 1  customer 1  'Fixture chat one: ...'      chat 2  booking 1  provider 1  'Fixture chat two: ...'
//   chat 3  booking 2  customer 2  'Fixture chat three: ...'    chat 4  booking 2  provider 2  'Fixture chat four: ...'
//
// provider_payouts: payout 3, a second payout of provider 2 on booking 2, 23.45. Payouts 1 and 2 (bookings.js) are both 64.00
// and GET /api/provider/payouts answers provider 1 and provider 2 with the same bytes, so with only those two a case could not
// tell provider 1's answer from provider 2's. The amount 23.45 is the string provider 1's answer must never hold. Only
// provider 2's own payouts and the admin payout list read the row.
//
// Not here, on purpose: customer addresses. The dev database has no `user_addresses` table (SHOW TABLES, 2026-10-04) and a
// fixture set that names a table the database lacks stops the loader, and a schema change is not this ticket's; the address
// cases in e2e/ownership.spec.js say what that leaves unobservable. An unassigned `pending` booking open to providers is made
// by the case itself through the public checkout (as e2e/defects.spec.js does) and deleted again, so no fixture holds one.
//
// Order: this set needs bookings and users, so it is listed after bookings. A chat message is not changed by a read; only
// POST /api/chat/mark-read marks one read and no route marks one unread, which the spec's header says (npm run db:fixtures
// puts them back).

const FIXED_AT = '2026-01-01 00:00:00';
const LATER_AT = '2026-01-01 00:01:00';

const chat = ({ id, bookingId, senderId, senderType, message, createdAt }) => ({
  id,
  booking_id: bookingId,
  sender_id: senderId,
  sender_type: senderType,
  message,
  is_read: 0,
  created_at: createdAt,
});

export const ownership = {
  name: 'ownership',
  tables: {
    chat_messages: [
      chat({ id: 1, bookingId: 1, senderId: 1, senderType: 'customer', message: 'Fixture chat one: Fixture Customer One asks Fixture Provider One about booking one.', createdAt: FIXED_AT }),
      chat({ id: 2, bookingId: 1, senderId: 1, senderType: 'provider', message: 'Fixture chat two: Fixture Provider One answers Fixture Customer One about booking one.', createdAt: LATER_AT }),
      chat({ id: 3, bookingId: 2, senderId: 2, senderType: 'customer', message: 'Fixture chat three: Fixture Customer Two asks Fixture Provider Two about booking two.', createdAt: FIXED_AT }),
      chat({ id: 4, bookingId: 2, senderId: 2, senderType: 'provider', message: 'Fixture chat four: Fixture Provider Two answers Fixture Customer Two about booking two.', createdAt: LATER_AT }),
    ],
    provider_payouts: [
      {
        id: 3,
        provider_id: 2,
        amount: 23.45,
        status: 'pending',
        stripe_payout_id: null,
        stripe_transfer_id: null,
        booking_id: 2,
        notes: 'Fixture second payout of provider 2, not sent anywhere.',
        created_at: LATER_AT,
        paid_at: null,
        updated_at: LATER_AT,
      },
    ],
  },
};
