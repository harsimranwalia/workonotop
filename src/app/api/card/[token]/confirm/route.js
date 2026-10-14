// Puts a card on file for a card link (ENG-013). The page has had Stripe confirm a SetupIntent with the card the customer typed and now names
// that SetupIntent here. Nothing the browser says about the card is believed: saveCardSetup fetches the SetupIntent from Stripe and saves it
// only when it succeeded, belongs to this link and its customer, is for off-session use and holds a card, and the brand and last four come
// from Stripe's answer. Every answer says no-store, the refusals and the errors too.

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { execute } from '@/lib/db'
import { logActivity } from '@/lib/logger'
import { notifyUser } from '@/lib/push'
import { findCardLink, saveCardSetup } from '@/lib/booking-card'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null

const ALREADY_ON_FILE = 'A card is already on file for this booking.'
const NOT_SAVED = 'This card could not be saved.'
const UNAVAILABLE = 'Card entry is not available right now. Please try again shortly.'

// A SetupIntent id is seti_ and the letters, digits and underscores Stripe makes ids of. The pattern also keeps a slash or a dot out of the
// path Stripe's client builds from it, and the length cap keeps an absurd string from being sent on.
const SETUP_INTENT_ID = /^seti_[A-Za-z0-9_]+$/
const SETUP_INTENT_ID_MAX = 255

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// The one answer for a link that cannot be used, whatever the reason (malformed, unknown, expired, booking closed), so a stranger who
// tries tokens learns nothing about which ones exist or why one failed.
function notValid() {
  return reply({ success: false, message: 'This link is not valid.' }, 404)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Tells the admins a card is on file, the way the public bookings route tells them of a new booking: one activity row and one push to every
// admin. Neither is waited for and neither can fail the customer's answer, which is already true by the time this runs. The actor is the system,
// not the customer: whoever holds the link added the card, and nothing here proves who that was. The push names the booking by its number and
// carries no customer detail. A failure is logged by its code alone.
function announceCardOnFile(link) {
  logActivity({
    actor_id: null, actor_type: 'system', actor_name: 'Card link',
    action: 'CARD_ON_FILE', entity_type: 'booking', entity_id: link.booking_id,
  })

  execute("SELECT id FROM users WHERE role = 'admin'").then((admins) => {
    admins.forEach((admin) => {
      notifyUser(admin.id, 'Card on file', `Card added for booking #${link.booking_number}`, { bookingId: link.booking_id, type: 'card_on_file' }, execute, 'admin')
        .catch(() => { })
    })
  }).catch((error) => {
    console.error('The card-added notice could not be sent:', error?.code || error?.name)
  })
}

// Public: the token in the path is the secret. The checks run in this order. A link that cannot be used is a 404 before the body is read; one
// out of tries is not that, because the tenth try spends the last one and its own card must still be saved (confirm starts no entry, and
// saveCardSetup believes only Stripe's answer). The body must be a JSON object whose setup_intent_id is a SetupIntent id, else 400. A link
// that already has its card is a 409. With no Stripe key the answer is a 503. Then saveCardSetup decides: 200 { success: true, card: { brand,
// last4 } }, 409 when a card was saved first (two confirms racing end here), 400 when the SetupIntent is not this link's or finished, 503.
export async function POST(request, { params }) {
  const { token } = await params

  try {
    const link = await findCardLink(execute, token)
    if (!link || !['ok', 'used', 'exhausted'].includes(link.state)) return notValid()

    let body
    try {
      body = await request.json()
    } catch {
      return reply({ success: false, message: NOT_SAVED }, 400)
    }
    const setupIntentId = isPlainObject(body) ? body.setup_intent_id : null
    if (typeof setupIntentId !== 'string' || setupIntentId.length > SETUP_INTENT_ID_MAX || !SETUP_INTENT_ID.test(setupIntentId)) {
      return reply({ success: false, message: NOT_SAVED }, 400)
    }

    if (link.state === 'used') return reply({ success: false, message: ALREADY_ON_FILE }, 409)
    if (!stripe) return reply({ success: false, message: UNAVAILABLE }, 503)

    const saved = await saveCardSetup(stripe, execute, link, setupIntentId)
    if (saved.ok) {
      announceCardOnFile(link)
      return reply({ success: true, card: { brand: saved.card.brand, last4: saved.card.last4 } })
    }
    if (saved.reason === 'used') return reply({ success: false, message: ALREADY_ON_FILE }, 409)
    if (saved.reason === 'invalid') return reply({ success: false, message: NOT_SAVED }, 400)
    return reply({ success: false, message: UNAVAILABLE }, 503)
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement.
    console.error('Error saving a card:', error?.code || error?.name)
    return reply({ success: false, message: 'Something went wrong. Please try again.' }, 500)
  }
}
