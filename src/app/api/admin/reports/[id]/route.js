// One on-site report, for the admin (ENG-017). GET answers the report with the booking it is about and, for the reports that can cost the customer
// money, the extra items of the booking's service the admin may approve. POST is the admin's decision: handle, decline, approve or retry. Approving an
// *Add more items* report prices it here on the server, refuses unless the sum is the one the admin was shown, records the approval, and only then
// charges the customer's card on file, on a PaymentIntent of its own (src/lib/report-desk.js, ADR-015). Nothing is sent to anyone from this route.
// Every answer says no-store.

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireCaller } from '@/lib/api-auth'
import { execute, withConnection } from '@/lib/db'
import { DESK_MESSAGES, decideReport, deskDetail } from '@/lib/report-desk'

// The client is built once, from the key the server holds; with no key it is null, and approving or retrying answers not_configured and writes nothing.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function refusal(status, message, more = {}) {
  return reply({ success: false, message, ...more }, status)
}

// The report id of the path as a number, or null when it is not a positive whole number written as digits.
function idOf(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

// Admin only. 200 { success: true, data: { report, catalogue } }: the report in the desk's shape and the booking's service's extra items
// ([{ code, label, amount, minutes, quote_from }], empty when the booking has no service). No id that is not a positive whole number, and no id
// that matches no report, is anything but the 404 "Report not found.".
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin'])
  if (!auth.ok) return auth.response

  try {
    const id = idOf((await params).id)
    const detail = id === null ? null : await deskDetail(execute, id)
    if (!detail) return refusal(404, DESK_MESSAGES.notFound)
    return reply({ success: true, data: detail })
  } catch (error) {
    console.error('Error reading a report:', error?.code || error?.name)
    return refusal(500, 'Failed to load the report')
  }
}

// How each reason decideReport gives is answered: its status and its message. 'decided' and the card's refusals come with the report as it stands;
// 'price_changed' comes with the server's sum, so the page can show the new total.
const ANSWERS = {
  note: [400, DESK_MESSAGES.note],
  extras: [400, DESK_MESSAGES.extras],
  quote: [400, DESK_MESSAGES.quote],
  below_minimum: [400, DESK_MESSAGES.belowMinimum],
  too_large: [400, DESK_MESSAGES.tooLarge],
  decided: [409, DESK_MESSAGES.decided],
  wrong_type: [409, DESK_MESSAGES.wrongType],
  status: [409, DESK_MESSAGES.status],
  price_changed: [409, DESK_MESSAGES.priceChanged],
  declined: [402, DESK_MESSAGES.declined],
  action_required: [402, DESK_MESSAGES.actionRequired],
  no_payment_method: [402, DESK_MESSAGES.noPaymentMethod],
  cancelled_by_person: [402, DESK_MESSAGES.cancelledByPerson],
  mismatch: [402, DESK_MESSAGES.mismatch],
  unavailable: [503, DESK_MESSAGES.unavailable],
  not_configured: [503, DESK_MESSAGES.notConfigured],
}

// Admin only. Body: JSON { action: 'handle' | 'decline' | 'approve' | 'retry', note?, extras?, expected_cents? }; `extras` is [{ code, quantity }] and
// `expected_cents` the whole-cent sum the admin was shown, both read only by approve. 200 { success: true, data: { report } } with the report as it now
// stands. Refused: not JSON, an action that is none of the four, or `extras` or `expected_cents` of the wrong type (400 "Invalid request."); no such
// report (404); a note that is too long, extras that are not this service's, a quote, a sum under 50 cents or over the ceiling (400); a report
// already decided or of the wrong kind, a booking that can not be charged, or a sum that is not the one shown (409; the last with `cents`, the
// server's sum); a card that was declined, needs the customer, is not on file or was cancelled, or a charge Stripe did not take as asked (402, with
// `report`, whose added_items.charge is 'failed' and whose reason says why); Stripe out of reach, or no payment key on this server (503; nothing is
// charged for either, and a retry is safe).
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin'])
  if (!auth.ok) return auth.response

  try {
    const id = idOf((await params).id)
    let body
    try {
      body = await request.json()
    } catch {
      return refusal(400, DESK_MESSAGES.action)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refusal(400, DESK_MESSAGES.action)
    const { action, note, extras, expected_cents: expectedCents } = body
    if (typeof action !== 'string') return refusal(400, DESK_MESSAGES.action)
    if (note !== undefined && note !== null && typeof note !== 'string') return refusal(400, DESK_MESSAGES.action)
    if (extras !== undefined && !Array.isArray(extras)) return refusal(400, DESK_MESSAGES.action)
    if (expectedCents !== undefined && !Number.isSafeInteger(expectedCents)) return refusal(400, DESK_MESSAGES.action)
    if (id === null) return refusal(404, DESK_MESSAGES.notFound)

    const decided = await decideReport({
      withConnection,
      execute,
      stripe,
      currency: process.env.STRIPE_CURRENCY || 'cad',
      id,
      admin: { id: auth.caller.id },
      action,
      note,
      extras,
      expectedCents,
    })
    if (decided.ok) return reply({ success: true, data: { report: decided.report } })
    if (decided.reason === 'action') return refusal(400, DESK_MESSAGES.action)
    if (decided.reason === 'not_found') return refusal(404, DESK_MESSAGES.notFound)
    const [status, message] = ANSWERS[decided.reason] ?? [500, 'Failed to decide the report']
    const more = {}
    if (decided.report) more.report = decided.report
    if (decided.cents !== undefined) more.cents = decided.cents
    return refusal(status, message, more)
  } catch (error) {
    console.error('Error deciding a report:', error?.code || error?.name)
    return refusal(500, 'Failed to decide the report')
  }
}
