// A request for a quote (ENG-012). A job whose answers the pricing rule sends to a quote has no price to book at, so the customer sends their
// contact details and a few words about the job instead, and the admin reads the requests, newest first. A request is a row of quote_requests,
// never a booking, so nothing that reads bookings can take it for a job; it holds no money.

import { NextResponse } from 'next/server'
import { requireCaller, callerFrom } from '@/lib/api-auth'
import { execute, query } from '@/lib/db'
import { loadPricing, priceJob, picksOf, refusalOf } from '@/lib/pricing-rules'
import { afterCommit } from '@/lib/notices'
import { noticeQuoteRequested } from '@/lib/notice-events'

// How many requests are saved in the last hour, per email and in all. Soft caps that guard the admin's queue, not a boundary: two requests at
// once can both pass, and a sender who varies the email is held by the overall cap, which can also shut real customers out for an hour.
const REQUESTS_PER_EMAIL_PER_HOUR = 3
const REQUESTS_PER_HOUR = 30

// The limits of the contact fields (the widths of their columns) and what a phone number may be made of.
const NAME_MAX = 120
const EMAIL_MAX = 254
const PHONE_MIN = 6
const PHONE_MAX = 40
const ADDRESS_MAX = 255
const MESSAGE_MAX = 1000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_CHARACTERS = /^[0-9 +().-]+$/

// The answers the pricing rule reads. Only these are kept, so the table holds nothing else that a request carried.
const ANSWER_KEYS = ['units', 'option', 'hours', 'property_type', 'date', 'extras', 'frequency']

// The list is read a page at a time: LIST_DEFAULT_LIMIT requests when the call names no size, never more than LIST_MAX_LIMIT.
const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 200

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Text as a form sends it, trimmed; null when it is not text at all.
const textOf = (value) => (typeof value === 'string' ? value.trim() : null)

// The body of a refusal: { success, message } as the neighbouring routes answer, with the field that failed when there is one.
function refusal(status, message, field) {
  return NextResponse.json({ success: false, message, ...(field ? { field } : {}) }, { status })
}

// A whole number from a query parameter, held to min..max; a missing or non-numeric value is the default. The job queue reads its page the same way.
function pageNumber(raw, defaultValue, min, max) {
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? defaultValue : Math.min(Math.max(n, min), max)
}

// A JSON column as the driver hands it back, parsed or as text; text that does not parse is null, so one bad row cannot fail the whole list.
function jsonOf(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

// The contact fields of the body, trimmed and checked in the order the form has them. Answers { ok: true, contact } or, for the first field that
// fails, { ok: false, field, message }. Phone and address are optional: left out, null or blank is none (null), anything else must be text.
function contactOf(body) {
  const failed = (field, message) => ({ ok: false, field, message })

  const name = textOf(body.name)
  if (!name || name.length > NAME_MAX) return failed('name', `Enter your name (up to ${NAME_MAX} characters)`)

  // The length is checked before the pattern, so the pattern never reads more than an address can be.
  const email = textOf(body.email)?.toLowerCase()
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return failed('email', 'Enter a valid email address')

  const phone = body.phone == null ? '' : textOf(body.phone)
  const phoneFits = phone !== null && (phone === '' || (phone.length >= PHONE_MIN && phone.length <= PHONE_MAX && PHONE_CHARACTERS.test(phone)))
  if (!phoneFits) return failed('phone', `Enter a phone number of ${PHONE_MIN} to ${PHONE_MAX} characters, using digits, spaces and + ( ) . - only, or leave it blank`)

  const address = body.address == null ? '' : textOf(body.address)
  if (address === null || address.length > ADDRESS_MAX) return failed('address', `Enter an address of up to ${ADDRESS_MAX} characters, or leave it blank`)

  const message = textOf(body.message)
  if (!message || message.length > MESSAGE_MAX) return failed('message', `Tell us about the job (up to ${MESSAGE_MAX} characters)`)

  return { ok: true, contact: { name, email, phone: phone || null, address: address || null, message } }
}

// The answers as they are stored: the keys the pricing rule reads and an extra reduced to its code and quantity, which is all the rule reads of it.
// Called for answers that priceJob has accepted, so each key that is there holds what the rule took it to hold.
function answersOf(answers) {
  const stored = {}
  for (const key of ANSWER_KEYS) {
    if (answers[key] !== undefined && answers[key] !== null) stored[key] = answers[key]
  }
  if (stored.extras) stored.extras = stored.extras.map(({ code, quantity }) => ({ code, quantity }))
  return stored
}

// Body: { service_id, answers, name, email, phone?, address?, message }. Public, like the booking flow: the customer has no account to sign in with.
// Saves the request and answers 201 { success: true, id } only when the pricing rule sends the answers to a quote; answers that can be priced are a
// booking, so they are refused and nothing is saved. user_id is the signed-in customer's, read from the credential: a user_id in the body is ignored.
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return refusal(400, 'Invalid request body')
  }
  if (!isPlainObject(body)) return refusal(400, 'Invalid request body')

  const checked = contactOf(body)
  if (!checked.ok) return refusal(400, checked.message, checked.field)
  const { name, email, phone, address, message } = checked.contact

  try {
    const { service, items, discounts } = await loadPricing(execute, body.service_id)
    const job = priceJob(service, items, body.answers, discounts)
    if (job.ok) return refusal(400, 'This job can be priced, so book it instead', 'answers')
    if (job.reason !== 'quote') return NextResponse.json(refusalOf(job), { status: 400 })

    // One read for both caps: the requests of the last hour, and how many of them are this email's (the SUM is NULL when there are none).
    const [recent] = await execute(
      'SELECT COUNT(*) AS total, SUM(customer_email = ?) AS from_email FROM quote_requests WHERE created_at > NOW() - INTERVAL 1 HOUR',
      [email]
    )
    if (Number(recent.total) >= REQUESTS_PER_HOUR || Number(recent.from_email ?? 0) >= REQUESTS_PER_EMAIL_PER_HOUR) {
      return refusal(429, 'Too many requests just now. Please try again in a little while.')
    }

    const customer = await callerFrom(request, ['customer'])
    const saved = await execute(
      `INSERT INTO quote_requests
         (user_id, service_id, service_name, customer_name, customer_email, customer_phone, address, message, answers, picks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer ? Number(customer.id) : null, service.id, service.name, name, email, phone, address, message,
        JSON.stringify(answersOf(body.answers)), JSON.stringify(picksOf(items, body.answers)),
      ]
    )
    // The new id is all that is logged: no body and no personal details.
    console.log(`[API Quote Requests] saved request ${saved.insertId}`)
    // The customer is told the request arrived once this answer has gone: by e-mail, and by text when a phone was sent (ENG-018). The notice reads the saved
    // row and its outcome is its own record, so nothing it does can change this answer.
    afterCommit(() => noticeQuoteRequested(execute, { quoteRequestId: saved.insertId }))
    return NextResponse.json({ success: true, id: saved.insertId }, { status: 201 })
  } catch (error) {
    console.error('Error saving the quote request:', error?.code, error?.message)
    return refusal(500, 'Failed to send the request')
  }
}

// Admin only: the requests, newest first, a page at a time. ?limit= (default 50, at most 200) and ?offset= as the job queue reads them. The answer
// carries total (every request) and the limit and offset it used, so a client pages by the values the server applied. Each request also carries
// booking_id and booking_number: the booking an admin made from it on the customer's behalf, both null while it has none.
export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const limit = pageNumber(searchParams.get('limit'), LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT)
    const offset = pageNumber(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

    // query, not execute: execute sends a JS number as a DOUBLE, which MySQL 8.0.22 and later refuse for LIMIT and OFFSET. The two are whole numbers read above.
    const rows = await query(
      `SELECT q.id, q.created_at, q.service_id, q.service_name, q.customer_name, q.customer_email, q.customer_phone, q.address, q.message, q.picks, q.answers, q.user_id,
              q.booking_id, b.booking_number
       FROM quote_requests q LEFT JOIN bookings b ON b.id = q.booking_id
       ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    )
    const [counted] = await execute('SELECT COUNT(*) AS total FROM quote_requests')

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({ ...row, picks: jsonOf(row.picks), answers: jsonOf(row.answers) })),
      total: Number(counted.total),
      limit,
      offset,
    })
  } catch (error) {
    console.error('Error loading the quote requests:', error)
    return refusal(500, 'Failed to load quote requests')
  }
}
