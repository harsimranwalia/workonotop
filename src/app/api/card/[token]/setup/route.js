// Starts one card entry for a card link (ENG-013). The page asks for a client secret and gives it to Stripe's own card field, so the card number
// goes from the customer's browser to Stripe and never through this server. A SetupIntent saves a card for later and holds or charges nothing:
// the one charge is taken when the job is done. Each call spends one of the link's ten tries, which is what keeps a link from testing
// stolen card numbers one after another. Every answer says no-store, the refusals and the errors too.

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { execute } from '@/lib/db'
import { findCardLink, startCardSetup } from '@/lib/booking-card'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null

const ALREADY_ON_FILE = 'A card is already on file for this booking.'
const UNAVAILABLE = 'Card entry is not available right now. Please try again shortly.'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// The one answer for a link that cannot be used, whatever the reason (malformed, unknown, expired, booking closed, tries used up, or a link
// that died between the read and the count), so a stranger who tries tokens learns nothing about which ones exist or why one failed.
function notValid() {
  return reply({ success: false, message: 'This link is not valid.' }, 404)
}

// Public: the token in the path is the secret, and the call reads no body. The checks run in this order. A link that cannot be used is a 404
// first. A link that already has its card is a 409. With no Stripe key on the server the answer is a 503 before startCardSetup, so a page that
// cannot take a card does not spend the link's tries. Then startCardSetup counts the try and creates the SetupIntent: 200 { success: true,
// client_secret }, a 404 when the link died since the read, a 503 when Stripe could not be reached or answered badly.
export async function POST(request, { params }) {
  const { token } = await params

  try {
    const link = await findCardLink(execute, token)
    if (!link) return notValid()
    if (link.state === 'used') return reply({ success: false, message: ALREADY_ON_FILE }, 409)
    if (link.state !== 'ok') return notValid()
    if (!stripe) return reply({ success: false, message: UNAVAILABLE }, 503)

    const started = await startCardSetup(stripe, execute, link)
    if (started.ok) return reply({ success: true, client_secret: started.client_secret })
    if (started.reason === 'dead') return notValid()
    return reply({ success: false, message: UNAVAILABLE }, 503)
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement.
    console.error('Error starting a card entry:', error?.code || error?.name)
    return reply({ success: false, message: 'Something went wrong. Please try again.' }, 500)
  }
}
