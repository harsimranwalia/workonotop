// What the page behind a card link is shown (ENG-013): the job the card is for, and, once a card is saved, which card. The link is the whole
// credential, so whoever holds it gets the service, the day, the slot and the price and nothing that names the customer or the booking. Every
// answer says no-store, the refusals and the errors too, so that no cache between this server and one customer's browser keeps a page meant for
// that customer alone.

import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { findCardLink } from '@/lib/booking-card'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// The one answer for a link that cannot be used, whatever the reason (malformed, unknown, expired, booking closed, tries used up), so a
// stranger who tries tokens learns nothing about which ones exist or why one failed.
function notValid() {
  return reply({ success: false, message: 'This link is not valid.' }, 404)
}

// A DATE column as YYYY-MM-DD. The driver hands a DATE back as a Date at local midnight, so its local year, month and day are the stored ones;
// toISOString would give the day before in any zone east of UTC. This is dayOf in booking-payment.js, which does not export it.
const DAY = /^\d{4}-\d{2}-\d{2}$/
function dayOf(value) {
  if (typeof value === 'string') return DAY.test(value) ? value : null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const two = (n) => String(n).padStart(2, '0')
    return `${String(value.getFullYear()).padStart(4, '0')}-${two(value.getMonth() + 1)}-${two(value.getDate())}`
  }
  return null
}

// Public: the token in the path is the secret. 200 { success: true, state: 'ok' | 'used', booking: { service_name, job_date, job_time_slot,
// price }, card: { brand, last4 } | null }. A link in any other state is the 404 above. The answer is built field by field from the row and never
// by spreading it, because the row also holds the customer's name and email, which this page must not carry. The card is shown only once the
// link has been used, which is the page's "already done" state.
export async function GET(request, { params }) {
  const { token } = await params

  try {
    const link = await findCardLink(execute, token)
    if (!link || (link.state !== 'ok' && link.state !== 'used')) return notValid()

    const price = Number(link.service_price)
    return reply({
      success: true,
      state: link.state,
      booking: {
        service_name: link.service_name,
        job_date: dayOf(link.job_date),
        job_time_slot: link.job_time_slot,
        price: Number.isFinite(price) ? price : null,
      },
      card: link.state === 'used' ? { brand: link.card_brand, last4: link.card_last4 } : null,
    })
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement.
    console.error('Error reading a card link:', error?.code || error?.name)
    return reply({ success: false, message: 'Something went wrong. Please try again.' }, 500)
  }
}
