// A booking's card link, for the admin (ENG-013). GET says what state the link is in and which card is on file; POST issues a new link. The
// row is made with the booking, so this route only ever replaces a token and never creates a link: a booking that was not made on a customer's
// behalf has no row, and gets none here. The token is not stored, only its hash, so GET cannot show it. It leaves the server in the answer to
// POST, to the admin who asked, and nowhere else here, and it is never logged.

import { NextResponse } from 'next/server'
import { requireCaller } from '@/lib/api-auth'
import { execute } from '@/lib/db'
import { logActivity } from '@/lib/logger'
import { CARD_LINK_DAYS, findCardLinkByBooking, newCardToken } from '@/lib/booking-card'

// The body of a refusal: { success, message } as the neighbouring routes answer.
function refusal(status, message) {
  return NextResponse.json({ success: false, message }, { status })
}

// The booking id of the path as a number, or null when it is not a positive whole number written as digits. Anything looser would reach SQL,
// where MySQL reads '5abc' as 5 and '1e3' as 1000.
function bookingIdOf(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

// Admin only. { success: true, card_link: { state, expires_at, attempts, card_on_file, card_brand, card_last4 } }, never a token. state is the
// link's own (ok, used, expired, closed or exhausted). A card is on file when the row holds the customer and the payment method the completion
// charge uses, which a reissue leaves in place, so a link that reads ok can still belong to a booking that has a card.
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  const bookingId = bookingIdOf((await params).id)
  if (bookingId === null) return refusal(400, 'The booking id must be a positive whole number')

  try {
    const link = await findCardLinkByBooking(execute, bookingId)
    if (!link) return refusal(404, 'This booking has no card link')

    const cardOnFile = Boolean(link.payment_method_id && link.stripe_customer_id)
    return NextResponse.json({
      success: true,
      card_link: {
        state: link.state,
        expires_at: link.expires_at,
        attempts: Number(link.attempts),
        card_on_file: cardOnFile,
        card_brand: cardOnFile ? link.card_brand : null,
        card_last4: cardOnFile ? link.card_last4 : null,
      },
    })
  } catch (error) {
    console.error('Error reading a card link:', error?.code || error?.name)
    return refusal(500, 'Failed to load the card link')
  }
}

// Admin only. Reissues the booking's link: a new token, an expiry a full lifetime from now, no tries used and no use recorded, and this admin as
// the one who issued it. The answer is { success: true, card_link: { path: '/card/{token}', expires_at } }, the only time the token is shown.
// The old token is gone from the row, so the old link stops working at once, and so does the id of its open card entry (the SetupIntent
// that link's page was handed): the new link starts an entry of its own and never hands out a client secret the old link's holder has seen.
// A card already on file is left alone: it stays until a later confirm replaces it, so a mistaken reissue cannot take a booking's card
// away. A booking that is completed, cancelled or disputed is a 409:
// its link is dead whatever token it holds, so a new one would be dead when the admin got it.
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  const bookingId = bookingIdOf((await params).id)
  if (bookingId === null) return refusal(400, 'The booking id must be a positive whole number')

  try {
    const link = await findCardLinkByBooking(execute, bookingId)
    if (!link) return refusal(404, 'This booking has no card link')
    if (link.state === 'closed') {
      return refusal(409, `A new card link cannot be issued for a booking that is ${link.booking_status}`)
    }

    const { token, hash } = newCardToken()
    // The expiry is the database's clock plus the lifetime: the same clock the link's state is read against, so no JavaScript clock is compared
    // with it. Nothing about the card is written here; only the id of an open card entry is dropped.
    await execute(
      `UPDATE booking_card_links
         SET token_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? DAY), attempts = 0, used_at = NULL, setup_intent_id = NULL, issued_by = ?
       WHERE booking_id = ?`,
      [hash, CARD_LINK_DAYS, auth.caller.id, bookingId]
    )
    // The expiry is read back, not worked out, so the admin is shown the date the row holds. No row means the booking went away since the read.
    const [issued] = await execute('SELECT expires_at FROM booking_card_links WHERE booking_id = ?', [bookingId])
    if (!issued) return refusal(404, 'This booking has no card link')

    logActivity({
      actor_id: auth.caller.id, actor_type: 'admin', actor_name: 'Admin',
      action: 'CARD_LINK_ISSUED', entity_type: 'booking', entity_id: bookingId,
    })

    // The answer holds a working link, so no cache may keep it.
    return NextResponse.json(
      { success: true, card_link: { path: `/card/${token}`, expires_at: issued.expires_at } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a token's hash.
    console.error('Error issuing a card link:', error?.code || error?.name)
    return refusal(500, 'Failed to issue the card link')
  }
}
