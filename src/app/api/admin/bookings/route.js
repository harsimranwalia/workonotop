// A booking an admin makes on a customer's behalf (ENG-013), for someone who rang or wrote in and will not use the app. It records the same
// booking as POST /api/bookings does, with three differences. The price is always the one the service's pricing rule gives for the answers,
// and a job that is normally a quote is priced from the rule all the same, with the picks that made it a quote written to the booking's
// history and to the activity log, so no admin can book at a price of their own. No payment is held: a link is made instead, on which the
// customer saves a card that is charged once, when the job is done. The customer is sent that link, by text and by e-mail, once the booking is
// saved (ENG-018), and the answer holds it as well, so the admin can pass it on when a message could not go. Repeating visits are not booked this way.

import { NextResponse } from 'next/server'
import { requireCaller } from '@/lib/api-auth'
import { execute, getConnection } from '@/lib/db'
import { notifyUser } from '@/lib/push'
import { logActivity } from '@/lib/logger'
import { catalogPrice } from '@/lib/booking-price'
import { loadPricing, priceJobPastQuote, refusalOf } from '@/lib/pricing-rules'
import { paymentAmountCents } from '@/lib/booking-payment'
import { normaliseJobDates, clusterForCity } from '@/lib/booking-input'
import { newCardToken, CARD_LINK_DAYS } from '@/lib/booking-card'
import { afterCommit } from '@/lib/notices'
import { noticeCardLink } from '@/lib/notice-events'

// Said by this route and by POST /api/admin/pricing alike: a price for repeating visits would be one this route refuses.
const REPEATING_REFUSED = "Repeating visits can't be booked on a customer's behalf yet."

const MAX_NOTE_LENGTH = 2000
const MAX_PHOTOS = 20
const MAX_PHOTO_URL_LENGTH = 500
const MAX_HISTORY_NOTE_LENGTH = 255
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// A photo is a path on this site or an http(s) address: nothing else can be shown in the app's gallery and a script address must not be stored.
const PHOTO_URL_PATTERN = /^(https?:\/\/\S+|\/(?!\/)\S*)$/

// The text fields of the booking, as [field, widest value its column holds, whether the booking needs it, what to call it in a message].
// The widths are those of the bookings columns (database/schema.js), so that a value too long is a 400 and not a 500 from the database.
const TEXT_RULES = [
  ['first_name', 100, true, "The customer's first name"],
  ['last_name', 100, true, "The customer's last name"],
  ['email', 254, true, "The customer's email"],
  ['phone', 50, false, 'The phone number'],
  ['address_line1', 255, true, 'The street address'],
  ['address_line2', 255, false, 'The second address line'],
  ['city', 100, false, 'The city'],
  ['postal_code', 20, false, 'The postal code'],
  ['job_description', MAX_NOTE_LENGTH, false, 'The job description'],
  ['instructions', MAX_NOTE_LENGTH, false, 'The instructions'],
  ['timing_constraints', MAX_NOTE_LENGTH, false, 'The timing notes'],
]

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// The answer of every refusal: { success: false, message } and, when one input is at fault, its name in `field`.
const refusal = (status, message, field) => NextResponse.json({ success: false, message, ...(field ? { field } : {}) }, { status })

// A text input, trimmed: '' when none was given, null when it is not text.
function textOf(value) {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value.trim() : null
}

// A row id from the body: a whole number from 1, or a string of digits only. Anything else names no row.
function idOf(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value) > 0 ? Number(value) : null
  return null
}

// A yes or no from the body: true, false, 1, 0, or nothing (which is no) give 1 or 0. Anything else is undefined, which the caller refuses.
function flagOf(value) {
  if (value === undefined || value === null || value === false || value === 0) return 0
  if (value === true || value === 1) return 1
  return undefined
}

// A coordinate: nothing (null), or a finite number no further from zero than `limit`, which is what the column can hold. Anything else is
// undefined, which the caller refuses.
function coordinateOf(value, limit) {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : undefined
}

// The photo addresses of the booking: [] when none are given; null when the list, or any address in it, is not acceptable.
function photosOf(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_PHOTOS) return null
  const urls = value.map((url) => (typeof url === 'string' ? url.trim() : ''))
  return urls.every((url) => url.length <= MAX_PHOTO_URL_LENGTH && PHOTO_URL_PATTERN.test(url)) ? urls : null
}

// The text fields as TEXT_RULES describes them: { ok: true, ...the trimmed values, email in lower case } or { ok: false, message, field }.
function fieldsOf(given) {
  const values = {}
  for (const [field, widest, required, name] of TEXT_RULES) {
    const text = textOf(given[field])
    if (text === null) return { ok: false, field, message: `${name} must be text.` }
    if (required && text === '') return { ok: false, field, message: `${name} is required.` }
    if (text.length > widest) return { ok: false, field, message: `${name} must be at most ${widest} characters.` }
    values[field] = text
  }
  values.email = values.email.toLowerCase()
  if (!EMAIL_PATTERN.test(values.email)) return { ok: false, field: 'email', message: 'Enter a valid email address.' }
  return { ok: true, ...values }
}

// The name the activity log shows for the admin: the account's own name, else its email, else 'Admin'. It is read after the booking is
// committed and never throws, because a name that could not be read must not fail a booking that has been made.
async function actorNameOf(caller) {
  try {
    const [admin] = await execute('SELECT first_name, last_name, email FROM users WHERE id = ?', [caller.id ?? null])
    if (!admin) return 'Admin'
    return `${admin.first_name || ''} ${admin.last_name || ''}`.trim() || admin.email || 'Admin'
  } catch {
    return 'Admin'
  }
}

// Body: the booking screen's own fields (service_id, first_name, last_name, email, phone, job_date, job_time_slot, timing_constraints,
// job_description, instructions, parking_access, elevator_access, has_pets, address_line1, address_line2, city, postal_code, latitude,
// longitude, photos, answers) and optionally quote_request_id, the request this booking answers. Whatever else the body carries is ignored:
// the price, the minutes, the account, the payment and the status are worked out here and cannot be given.
// Answers 201 { success, booking_id, booking_number, service_price, quoted_minutes, account_matched, card_link: { path, expires_at } },
// or a 400 that names the input at fault, or a 409 when the quote request already has a booking (nothing is written then).
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;

  let body
  try {
    body = await request.json()
  } catch {
    return refusal(400, 'Invalid request body')
  }
  if (!isPlainObject(body)) return refusal(400, 'Invalid request body')

  const {
    service_id, first_name, last_name, email, phone,
    job_date, job_time_slot, timing_constraints, job_description, instructions,
    parking_access, elevator_access, has_pets,
    address_line1, address_line2, city, postal_code, latitude, longitude,
    photos, answers, quote_request_id,
  } = body

  if (isPlainObject(answers) && answers.frequency != null) return refusal(400, REPEATING_REFUSED, 'frequency')

  const serviceId = idOf(service_id)
  if (serviceId === null) return refusal(400, 'Choose a service.', 'service_id')

  const fields = fieldsOf({ first_name, last_name, email, phone, address_line1, address_line2, city, postal_code, job_description, instructions, timing_constraints })
  if (!fields.ok) return refusal(400, fields.message, fields.field)

  const flags = { parking_access: flagOf(parking_access), elevator_access: flagOf(elevator_access), has_pets: flagOf(has_pets) }
  const badFlag = Object.keys(flags).find((name) => flags[name] === undefined)
  if (badFlag) return refusal(400, 'This must be yes or no.', badFlag)

  const lat = coordinateOf(latitude, 90)
  if (lat === undefined) return refusal(400, 'The latitude must be a number from -90 to 90.', 'latitude')
  const lng = coordinateOf(longitude, 180)
  if (lng === undefined) return refusal(400, 'The longitude must be a number from -180 to 180.', 'longitude')

  const photoUrls = photosOf(photos)
  if (photoUrls === null) return refusal(400, 'The photos must be a list of up to 20 addresses.', 'photos')

  const hasQuoteRequest = quote_request_id !== undefined && quote_request_id !== null
  const quoteRequestId = hasQuoteRequest ? idOf(quote_request_id) : null
  if (hasQuoteRequest && quoteRequestId === null) return refusal(400, 'That quote request does not exist.', 'quote_request_id')

  const dates = normaliseJobDates(job_date, fields.timing_constraints, job_time_slot)
  if (!dates.ok) return refusal(400, dates.message, dates.field)

  let connection
  try {
    const { service: serviceInfo, items: pricingItems, discounts } = await loadPricing(execute, serviceId)
    // The rule is given the booking's own first date in place of any date the answers hold; with no answers, no date is read.
    const isAnswersObject = isPlainObject(answers)
    const hasAnswers = answers !== undefined && answers !== null && !(isAnswersObject && Object.keys(answers).length === 0)
    const ruleAnswers = hasAnswers && isAnswersObject ? { ...answers, date: dates.primaryJobDate } : answers
    const job = priceJobPastQuote(serviceInfo, pricingItems, ruleAnswers, discounts)
    if (!job.ok) {
      // The date the rule refuses is the booking's first date, which this route calls job_date.
      const refused = refusalOf(job)
      return NextResponse.json(job.field === 'date' ? { ...refused, field: 'job_date' } : refused, { status: 400 })
    }
    const catalog = catalogPrice(serviceInfo)
    if (!catalog) return refusal(400, 'This service is not available for booking', 'service_id')

    const basePrice = job.price
    const bounds = paymentAmountCents(basePrice)
    if (!bounds.ok) {
      return refusal(
        400,
        bounds.reason === 'below_minimum'
          ? 'The price for these answers is below the smallest amount a card payment can take'
          : 'The price for these answers is larger than a card payment can take',
        'answers',
      )
    }

    // A request that names no row, or whose row already has a booking, is refused before anything is written. The update inside the
    // transaction below is what settles two admins racing for the same request.
    if (quoteRequestId !== null) {
      const [quote] = await execute('SELECT id, booking_id FROM quote_requests WHERE id = ?', [quoteRequestId])
      if (!quote) return refusal(400, 'That quote request does not exist.', 'quote_request_id')
      if (quote.booking_id) return refusal(409, 'That quote request already has a booking.')
    }

    // The booking joins the customer's account when one has the same email, so it shows in their app once they sign in. No account is ever
    // made from here: without a match the booking is a guest booking, as the public route records one.
    const accounts = await execute("SELECT id FROM users WHERE email = ? AND role = 'user'", [fields.email])
    const accountId = accounts.length > 0 ? accounts[0].id : null

    const jobCluster = await clusterForCity(execute, fields.city)
    const bookingNumber = 'BK' + Date.now() + Math.floor(Math.random() * 1000)
    const serviceName = serviceInfo.name || null
    const card = newCardToken()
    const priced = job.quote_flags.length > 0 ? `, priced by the rules past a quote verdict: ${job.quote_flags.map((flag) => flag.label).join(', ')}` : ''
    const historyNote = `Booking created by an admin on the customer's behalf${priced}`.slice(0, MAX_HISTORY_NOTE_LENGTH)

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    let bookingId
    let expiresAt
    try {
      const [result] = await connection.execute(
        `INSERT INTO bookings
         (booking_number, user_id, service_id, service_name, service_price, additional_price,
          customer_first_name, customer_last_name, customer_email, customer_phone,
          job_date, job_time_slot, timing_constraints, job_description, instructions,
          parking_access, elevator_access, has_pets,
          address_line1, address_line2, city, postal_code, latitude, longitude, cluster,
          commission_percent, provider_amount, status, job_timer_status, payment_status,
          standard_duration_minutes, price_breakdown, payment_intent_id, authorized_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,'pending','not_started','pending',?,?,NULL,NULL)`,
        [
          bookingNumber, accountId, serviceInfo.id, serviceName,
          basePrice, catalog.rate,
          fields.first_name, fields.last_name, fields.email, fields.phone,
          dates.primaryJobDate, dates.timeSlotString, dates.finalTimingConstraints || null,
          fields.job_description, fields.instructions || null,
          flags.parking_access, flags.elevator_access, flags.has_pets,
          fields.address_line1, fields.address_line2 || null, fields.city, fields.postal_code || null,
          lat, lng, jobCluster,
          job.minutes || 60, JSON.stringify(job.lines),
        ]
      )
      bookingId = result.insertId

      for (const photo of photoUrls) {
        await connection.execute('INSERT INTO booking_photos (booking_id, photo_url) VALUES (?, ?)', [bookingId, photo])
      }

      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'pending', ?)`,
        [bookingId, historyNote]
      )

      // The link is stored as the hash of its token, so a copy of the table opens no link; the token itself is answered once, below.
      await connection.execute(
        'INSERT INTO booking_card_links (booking_id, token_hash, expires_at, issued_by) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)',
        [bookingId, card.hash, CARD_LINK_DAYS, auth.caller.id ?? null]
      )
      // The expiry is read back from the row, so the answer states the time the database holds and not one worked out in JavaScript.
      const [issued] = await connection.execute('SELECT expires_at FROM booking_card_links WHERE booking_id = ?', [bookingId])
      if (!issued || issued.length === 0) throw new Error('The card link was not stored')
      expiresAt = issued[0].expires_at

      if (quoteRequestId !== null) {
        const [linked] = await connection.execute('UPDATE quote_requests SET booking_id = ? WHERE id = ? AND booking_id IS NULL', [bookingId, quoteRequestId])
        if (linked.affectedRows !== 1) {
          await connection.query('ROLLBACK')
          return refusal(409, 'That quote request already has a booking.')
        }
      }

      await connection.query('COMMIT')
    } catch (err) {
      await connection.query('ROLLBACK').catch((rollbackError) => console.error('The rollback failed:', rollbackError?.code ?? rollbackError?.name))
      throw err
    }

    // The booking is made from here on: nothing below may fail it. The customer is sent the card link once this answer has gone, and no confirmation
    // with it: the one message is the booking's confirmation, with the quote and the link (ENG-018). The answer still holds the link, for the admin.
    const actorName = await actorNameOf(auth.caller)
    try {
      afterCommit(() => noticeCardLink(execute, { bookingId, token: card.token }))
      logActivity({
        actor_id: auth.caller.id ?? null,
        actor_type: 'admin',
        actor_name: actorName,
        action: 'BOOKING_CREATED',
        entity_type: 'booking',
        entity_id: bookingId,
        details: { on_behalf: true, amount: basePrice, quote_flags: job.quote_flags },
      })

      execute("SELECT id FROM users WHERE role = 'admin'").then((admins) => {
        admins.forEach((admin) => {
          notifyUser(admin.id, 'New Booking Created', `New booking #${bookingNumber} for ${serviceName}`, { bookingId, type: 'booking_created' }, execute, 'admin')
            .catch((error) => console.error('The new-booking push could not be sent:', error?.code ?? error?.name))
        })
      }).catch((error) => console.error('The new-booking notice could not be sent:', error?.code ?? error?.name))
    } catch (err) {
      console.error('A booking was made on a customer\'s behalf but its log entry or notice failed:', err?.code ?? err?.name)
    }

    return NextResponse.json({
      success: true,
      booking_id: bookingId,
      booking_number: bookingNumber,
      service_price: basePrice,
      quoted_minutes: job.minutes,
      account_matched: accountId !== null,
      card_link: { path: `/card/${card.token}`, expires_at: expiresAt },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Only the code is logged: a database message can carry the values that were being written.
    console.error('Error creating a booking on a customer\'s behalf:', error?.code ?? error?.name)
    return refusal(500, 'Failed to create booking')
  } finally {
    if (connection) connection.release()
  }
}
