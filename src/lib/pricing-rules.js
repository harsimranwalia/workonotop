// The price and the quoted minutes of a job, worked out on the server from the service's pricing rule and the answers given. A rule is
// the service's catalog price and duration plus its rows in service_pricing_items: amounts per unit, options (a tier, or an amount an
// hour), property types, the weekend and extras by quantity. Every part adds to the price in whole cents; only the hourly line is
// rounded, once, to the cent. A booking that repeats takes a percent off the sum of each visit, by how often it repeats, as a line of its
// own, rounded once, to the cent; the percents are settings in system_settings. A job that picks an item as many times as the item's
// quote_from is not priced at all: it is a job for a quote, and what comes back carries no figure for a caller to use.

import { catalogPrice } from './booking-price.js'
import { FREQUENCIES, visitDates } from './visit-series.js'

// What decimal(10,2) holds, in cents, and what an int holds, in minutes. A quantity has no other limit.
const MAX_CENTS = 9999999999n
const MAX_MINUTES = 2147483647n
// The minutes of a service whose catalog row has none, as the catalog's readers have always taken it.
const NO_DURATION_MINUTES = 60
// A percent is held in hundredths of a percent: a whole number from 0 (nothing off) to 10000 (all of it).
const MAX_HUNDREDTHS = 10000

const KINDS = ['unit', 'option', 'property_type', 'weekend', 'extra']

const refuse = (field) => ({ ok: false, reason: 'answers', field })
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isGiven = (value) => value !== undefined && value !== null
// A JSON number that is a whole number from 0 up; a string, a fraction or a negative number is not one.
const isQuantity = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// An amount of a pricing item (a decimal column arrives as a string), in whole cents. A row the table's own checks would have
// refused is a fault in the rule, not in the answers, so it stops the price rather than changing it.
function centsOf(item) {
  const amount = Number(item.amount)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`pricing item ${item.kind}/${item.code} has an amount that is not a number from 0 up`)
  return BigInt(Math.round(amount * 100))
}

function minutesOf(item) {
  const minutes = Number(item.minutes)
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error(`pricing item ${item.kind}/${item.code} has minutes that are not a whole number from 0 up`)
  return BigInt(minutes)
}

// Hours as hundredths of an hour, read from the number's own digits so that no float arithmetic is involved: a JSON number above 0
// with at most two decimals, else null.
function hundredthsOf(hours) {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return null
  const digits = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(hours))
  if (!digits) return null
  return BigInt(digits[1]) * 100n + BigInt((digits[2] || '').padEnd(2, '0'))
}

// The weekday of a YYYY-MM-DD day (0 is Sunday, 6 is Saturday), worked from the date's own numbers in UTC so that no time zone plays a
// part, or null when the text is not a real day.
function weekdayOf(day) {
  const parts = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null
  if (!parts) return null
  const [year, month, date] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const when = new Date(Date.UTC(year, month - 1, date))
  if (when.getUTCFullYear() !== year || when.getUTCMonth() !== month - 1 || when.getUTCDate() !== date) return null
  return when.getUTCDay()
}

function twoPlaces(cents) {
  const digits = cents.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

// The percent off that `discounts` ({ <frequency>: hundredths of a percent }) gives a booking that repeats at `frequency`, in hundredths of a
// percent; 0 when it names none. A value that is not a whole number from 0 to 10000 is a fault in the caller, not in the answers, so it
// stops the price rather than changing it.
function discountOf(discounts, frequency) {
  const hundredths = isPlainObject(discounts) ? discounts[frequency] : undefined
  if (!isGiven(hundredths)) return 0
  if (!Number.isSafeInteger(hundredths) || hundredths < 0 || hundredths > MAX_HUNDREDTHS) {
    throw new Error(`the discount for ${frequency} is not a whole number of hundredths of a percent from 0 to ${MAX_HUNDREDTHS}`)
  }
  return hundredths
}

// A percent held in hundredths, as text without trailing zeros: 1000 is '10', 1250 is '12.5', 1255 is '12.55'.
function percentText(hundredths) {
  const decimals = String(hundredths % 100).padStart(2, '0').replace(/0+$/, '')
  return `${Math.floor(hundredths / 100)}${decimals ? `.${decimals}` : ''}`
}

// That many hundredths of a percent of a sum of cents, in cents: a half cent rounds up.
function discountCentsOf(cents, hundredths) {
  return (cents * BigInt(hundredths) + 5000n) / 10000n
}

// The service's items by kind and then by code, in the order given. A code is looked up here and nowhere else, so no answer reaches a query.
function itemsByKind(items) {
  const byKind = Object.fromEntries(KINDS.map((kind) => [kind, new Map()]))
  for (const item of items || []) {
    if (item && KINDS.includes(item.kind)) byKind[item.kind].set(item.code, item)
  }
  return byKind
}

// How many of an item send a job to a quote: a whole number from 1 up, or null when the item never does (a NULL quote_from). A value the
// table's own check would have refused is a fault in the rule, not in the answers, so it stops the price rather than changing it.
function quoteFromOf(item) {
  if (!isGiven(item.quote_from)) return null
  const from = Number(item.quote_from)
  if (!Number.isSafeInteger(from) || from < 1) throw new Error(`pricing item ${item.kind}/${item.code} has a quote_from that is not a whole number from 1 up`)
  return from
}

// Every pick that valid `answers` make from `items`, as { kind, code, label, quantity, flagged }: the units asked for, then the option, the
// property type, and the extras asked for (a unit or an extra by its count, in the order of `items`; an option or a property type once). A
// pick is flagged when its item has a quote_from and the quantity reaches it. The weekend is not a pick. Read for answers that priceJob has
// accepted: it skips what it does not recognise rather than refusing it. Pure; no money in what it answers.
export function picksOf(items, answers) {
  const given = isPlainObject(answers) ? answers : {}
  const byKind = itemsByKind(items)
  const picks = []
  const pick = (item, quantity) => {
    const from = quoteFromOf(item)
    picks.push({ kind: item.kind, code: item.code, label: item.label, quantity, flagged: from !== null && quantity >= from })
  }

  const units = isPlainObject(given.units) ? given.units : {}
  for (const [code, item] of byKind.unit) {
    if (isQuantity(units[code]) && units[code] > 0) pick(item, units[code])
  }
  if (typeof given.option === 'string' && byKind.option.has(given.option)) pick(byKind.option.get(given.option), 1)
  if (typeof given.property_type === 'string' && byKind.property_type.has(given.property_type)) pick(byKind.property_type.get(given.property_type), 1)

  const extras = new Map()
  for (const extra of Array.isArray(given.extras) ? given.extras : []) {
    if (isPlainObject(extra) && !extras.has(extra.code) && isQuantity(extra.quantity)) extras.set(extra.code, extra.quantity)
  }
  for (const [code, item] of byKind.extra) {
    if (extras.get(code) > 0) pick(item, extras.get(code))
  }
  return picks
}

// The picks of `answers` that send the job to a quote, as { kind, code, label, quantity }: empty when it can be priced.
export function quoteFlagsOf(items, answers) {
  return picksOf(items, answers).filter((pick) => pick.flagged).map(({ kind, code, label, quantity }) => ({ kind, code, label, quantity }))
}

// `service` is a services row, `items` the service's rows of service_pricing_items, `answers` the optional answers of the request:
//   { units: { <unit code>: <whole number> }, option: <option code>, hours: <number>, property_type: <property type code>,
//     date: 'YYYY-MM-DD', extras: [ { code: <extra code>, quantity: <whole number> } ], frequency: <a key of FREQUENCIES> }
// `discounts` is { <frequency>: hundredths of a percent } (loadPricing answers it); a frequency it does not name takes nothing off.
// Answers { ok: true, price, minutes, lines } with each line { kind, code, label, quantity, amount, minutes } (amount a two-place
// string), or { ok: false, reason: 'service' } when the catalog does not offer the service, or { ok: false, reason: 'answers', field }
// when the answers cannot be priced, or { ok: false, reason: 'too_large', field: 'answers' } when the price or the minutes are more than a
// booking records, or { ok: false, reason: 'quote', field: 'quote', flags } when the answers pick an item as many times as its quote_from
// (`flags`: [{ kind, code, label, quantity }], the picks that did): no price, minutes or lines come with it, so a caller that does not
// know the reason has nothing to charge. No answers price the catalog price and duration. By the hour, the hours asked for replace the base and the units.
// No frequency is a single visit. A frequency that takes a percent off adds a last line { kind: 'discount', code: <the frequency>, ... } whose
// amount is the cut as a negative two-place string ('-13.50'); the price is the sum of the other lines less the cut, and the minutes are theirs.
export function priceJob(service, items, answers, discounts = {}) {
  const offered = catalogPrice(service)
  if (!offered) return { ok: false, reason: 'service' }
  const given = isGiven(answers) ? answers : {}
  if (!isPlainObject(given)) return refuse('answers')

  const frequency = isGiven(given.frequency) ? given.frequency : null
  if (frequency !== null && !Object.keys(FREQUENCIES).includes(frequency)) return refuse('frequency')
  const discountHundredths = frequency === null ? 0 : discountOf(discounts, frequency)

  const byKind = itemsByKind(items)

  const unitQuantities = new Map()
  if (isGiven(given.units)) {
    if (!isPlainObject(given.units)) return refuse('units')
    for (const [code, quantity] of Object.entries(given.units)) {
      if (!byKind.unit.has(code) || !isQuantity(quantity)) return refuse('units')
      unitQuantities.set(code, BigInt(quantity))
    }
  }

  let option = null
  if (isGiven(given.option)) {
    if (typeof given.option !== 'string' || !byKind.option.has(given.option)) return refuse('option')
    option = byKind.option.get(given.option)
  }
  const byTheHour = option !== null && Number(option.is_hourly) === 1

  // Declared without a value: next build's file tracing reads `let x = null` as a constant and then evaluates `x * 60n` below, which it cannot do.
  let hundredths
  if (isGiven(given.hours)) {
    hundredths = byTheHour ? hundredthsOf(given.hours) : null
    if (hundredths === null) return refuse('hours')
  } else if (byTheHour) {
    return refuse('hours')
  }

  let propertyType = null
  if (isGiven(given.property_type)) {
    if (typeof given.property_type !== 'string' || !byKind.property_type.has(given.property_type)) return refuse('property_type')
    propertyType = byKind.property_type.get(given.property_type)
  }

  let weekend = false
  if (isGiven(given.date)) {
    const weekday = weekdayOf(given.date)
    if (weekday === null) return refuse('date')
    weekend = weekday === 0 || weekday === 6
  }

  const extraQuantities = new Map()
  if (isGiven(given.extras)) {
    if (!Array.isArray(given.extras)) return refuse('extras')
    for (const extra of given.extras) {
      if (!isPlainObject(extra) || typeof extra.code !== 'string' || !byKind.extra.has(extra.code)) return refuse('extras')
      if (extraQuantities.has(extra.code) || !isQuantity(extra.quantity)) return refuse('extras')
      extraQuantities.set(extra.code, BigInt(extra.quantity))
    }
  }

  // The verdict comes after every answer is known to be valid, so a malformed answer is its own refusal, and before any figure is
  // worked out, so a job that needs a quote has no price, minutes or lines to leave with.
  const flags = quoteFlagsOf(items, given)
  if (flags.length > 0) return { ok: false, reason: 'quote', field: 'quote', flags }

  const lines = []
  let cents = 0n
  let minutes = 0n
  const addLine = (kind, code, label, quantity, lineCents, lineMinutes) => {
    cents += lineCents
    minutes += lineMinutes
    lines.push({ kind, code, label, quantity: Number(quantity), amount: twoPlaces(lineCents), minutes: Number(lineMinutes) })
  }

  if (byTheHour) {
    const hourlyCents = (hundredths * centsOf(option) + 50n) / 100n
    const hourlyMinutes = (hundredths * 60n + 50n) / 100n
    addLine('option', option.code, option.label, given.hours, hourlyCents, hourlyMinutes)
  } else {
    const baseMinutes = Number(service.duration_minutes)
    addLine('base', 'base', service.name, 1, BigInt(Math.round(offered.price * 100)), BigInt(Number.isSafeInteger(baseMinutes) && baseMinutes > 0 ? baseMinutes : NO_DURATION_MINUTES))
    for (const [code, item] of byKind.unit) {
      const quantity = unitQuantities.get(code) || 0n
      if (quantity > 0n) addLine('unit', code, item.label, quantity, quantity * centsOf(item), quantity * minutesOf(item))
    }
    if (option !== null) addLine('option', option.code, option.label, 1, centsOf(option), minutesOf(option))
  }

  if (propertyType !== null) addLine('property_type', propertyType.code, propertyType.label, 1, centsOf(propertyType), minutesOf(propertyType))
  if (weekend) {
    for (const item of byKind.weekend.values()) addLine('weekend', item.code, item.label, 1, centsOf(item), minutesOf(item))
  }
  for (const [code, item] of byKind.extra) {
    const quantity = extraQuantities.get(code) || 0n
    if (quantity > 0n) addLine('extra', code, item.label, quantity, quantity * centsOf(item), quantity * minutesOf(item))
  }

  if (cents > MAX_CENTS || minutes > MAX_MINUTES) return { ok: false, reason: 'too_large', field: 'answers' }
  // An hourly amount of 0 prices nothing, as a base price of 0 is not offered.
  if (cents <= 0n) return refuse('option')
  if (discountHundredths > 0) {
    const discountCents = discountCentsOf(cents, discountHundredths)
    const label = `${FREQUENCIES[frequency].label} discount (${percentText(discountHundredths)}%)`
    lines.push({ kind: 'discount', code: frequency, label, quantity: 1, amount: `-${twoPlaces(discountCents)}`, minutes: 0 })
    return { ok: true, price: Number(cents - discountCents) / 100, minutes: Number(minutes), lines }
  }
  return { ok: true, price: Number(cents) / 100, minutes: Number(minutes), lines }
}

// The price of each visit of a booking, for `answers` as priceJob takes them. With a frequency, a visit on each date of
// visitDates(answers.frequency, answers.date), each priced by priceJob with that date as its date, so that the weekend is worked out for the
// visit's own day. Answers { ok: true, visits: [{ date, price, minutes, lines }] } in date order, or the first refusal priceJob gives; a
// frequency with no real start day is { ok: false, reason: 'answers', field: 'date' }. With no frequency, one visit on answers.date (null when
// there is none), priced by priceJob as it stands.
export function priceVisits(service, items, answers, discounts) {
  const given = isPlainObject(answers) ? answers : {}
  if (!isGiven(given.frequency)) {
    const job = priceJob(service, items, answers, discounts)
    if (!job.ok) return job
    return { ok: true, visits: [{ date: typeof given.date === 'string' ? given.date : null, price: job.price, minutes: job.minutes, lines: job.lines }] }
  }

  const dates = visitDates(given.frequency, given.date)
  if (dates === null) {
    // No dates: priceJob refuses the service, a frequency outside the list, a start that is not a real day or any other answer it cannot
    // price; if it refuses none of them, the start is missing.
    const job = priceJob(service, items, answers, discounts)
    return job.ok ? refuse('date') : job
  }
  const visits = []
  for (const date of dates) {
    const job = priceJob(service, items, { ...given, date }, discounts)
    if (!job.ok) return job
    visits.push({ date, price: job.price, minutes: job.minutes, lines: job.lines })
  }
  return { ok: true, visits }
}

// The body of the 400 that a route answers when priceJob does not price: { success, message } as the neighbouring routes answer, with the
// answer that cannot be priced named in `field`.
export function refusalOf(job) {
  if (job.reason === 'service') return { success: false, message: 'This service is not available for booking' }
  if (job.reason === 'too_large') return { success: false, message: 'The price for these answers is larger than a booking can record', field: job.field }
  if (job.reason === 'quote') return { success: false, message: 'This job needs a quote, not a price', field: job.field }
  return { success: false, message: 'These answers cannot be priced for this service', field: job.field }
}

// A service id as the routes receive it: a number, or a string of digits only. Anything else names no service.
function serviceIdOf(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value) > 0 ? Number(value) : null
  return null
}

// The system_settings key that holds the percent off a booking that repeats at `frequency`.
const discountKeyOf = (frequency) => `recurring_discount_${frequency}_percent`

// A percent as its setting holds it, in hundredths of a percent: text (or a number) from 0 to 100 with at most two decimals, read from its own
// digits so that no float arithmetic is involved; anything else is 0.
function percentHundredths(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const digits = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(value).trim())
  if (!digits) return 0
  const hundredths = Number(digits[1]) * 100 + Number((digits[2] || '').padEnd(2, '0'))
  return hundredths <= MAX_HUNDREDTHS ? hundredths : 0
}

// The percent off for each frequency, in hundredths of a percent, from the system_settings rows read for them: 0 for a frequency whose
// setting is missing or unreadable.
function discountsOf(settings) {
  const stored = new Map((settings || []).map((row) => [row.key, row.value]))
  return Object.fromEntries(Object.keys(FREQUENCIES).map((frequency) => [frequency, percentHundredths(stored.get(discountKeyOf(frequency)))]))
}

// The one read of a service's rule and of the percents off a booking that repeats: its catalog row, its items and the discount settings, by
// `execute(sql, params)` (the database helper's, passed in so that this module holds no connection). Answers { service, items, discounts };
// `service` is undefined when there is no such row. `discounts` is { <frequency>: hundredths of a percent } for every key of FREQUENCIES.
export async function loadPricing(execute, serviceId) {
  const id = serviceIdOf(serviceId)
  if (id === null) return { service: undefined, items: [], discounts: {} }
  const [service] = await execute('SELECT id, name, base_price, additional_price, duration_minutes, is_active FROM services WHERE id = ?', [id])
  if (!service) return { service: undefined, items: [], discounts: {} }
  const items = await execute('SELECT kind, code, label, amount, minutes, is_hourly, quote_from FROM service_pricing_items WHERE service_id = ? ORDER BY kind, sort_order, id', [id])
  const keys = Object.keys(FREQUENCIES).map(discountKeyOf)
  const settings = await execute(`SELECT \`key\`, \`value\` FROM system_settings WHERE \`key\` IN (${keys.map(() => '?').join(', ')})`, keys)
  return { service, items, discounts: discountsOf(settings) }
}
