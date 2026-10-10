// The price and the quoted minutes of a job, worked out on the server from the service's pricing rule and the answers given. A rule is
// the service's catalog price and duration plus its rows in service_pricing_items: amounts per unit, options (a tier, or an amount an
// hour), property types, the weekend and extras by quantity. Every part adds to the price in whole cents; only the hourly line is
// rounded, once, to the cent.

import { catalogPrice } from './booking-price.js'

// What decimal(10,2) holds, in cents, and what an int holds, in minutes. A quantity has no other limit.
const MAX_CENTS = 9999999999n
const MAX_MINUTES = 2147483647n
// The minutes of a service whose catalog row has none, as the catalog's readers have always taken it.
const NO_DURATION_MINUTES = 60

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

// `service` is a services row, `items` the service's rows of service_pricing_items, `answers` the optional answers of the request:
//   { units: { <unit code>: <whole number> }, option: <option code>, hours: <number>, property_type: <property type code>,
//     date: 'YYYY-MM-DD', extras: [ { code: <extra code>, quantity: <whole number> } ] }
// Answers { ok: true, price, minutes, lines } with each line { kind, code, label, quantity, amount, minutes } (amount a two-place
// string), or { ok: false, reason: 'service' } when the catalog does not offer the service, or { ok: false, reason: 'answers', field }
// when the answers cannot be priced, or { ok: false, reason: 'too_large', field: 'answers' } when the price or the minutes are more than a
// booking records. No answers price the catalog price and duration. By the hour, the hours asked for replace the base and the units.
export function priceJob(service, items, answers) {
  const offered = catalogPrice(service)
  if (!offered) return { ok: false, reason: 'service' }
  const given = isGiven(answers) ? answers : {}
  if (!isPlainObject(given)) return refuse('answers')

  // The service's items by kind and code. A code is looked up here and nowhere else, so no answer reaches a query.
  const byKind = Object.fromEntries(KINDS.map((kind) => [kind, new Map()]))
  for (const item of items || []) {
    if (item && KINDS.includes(item.kind)) byKind[item.kind].set(item.code, item)
  }

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
  return { ok: true, price: Number(cents) / 100, minutes: Number(minutes), lines }
}

// The body of the 400 that a route answers when priceJob does not price: { success, message } as the neighbouring routes answer, with the
// answer that cannot be priced named in `field`.
export function refusalOf(job) {
  if (job.reason === 'service') return { success: false, message: 'This service is not available for booking' }
  if (job.reason === 'too_large') return { success: false, message: 'The price for these answers is larger than a booking can record', field: job.field }
  return { success: false, message: 'These answers cannot be priced for this service', field: job.field }
}

// A service id as the routes receive it: a number, or a string of digits only. Anything else names no service.
function serviceIdOf(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value) > 0 ? Number(value) : null
  return null
}

// The one read of a service's rule: its catalog row and its items, by `execute(sql, params)` (the database helper's, passed in so that this
// module holds no connection). Answers { service, items }; `service` is undefined when there is no such row.
export async function loadPricing(execute, serviceId) {
  const id = serviceIdOf(serviceId)
  if (id === null) return { service: undefined, items: [] }
  const [service] = await execute('SELECT id, name, base_price, additional_price, duration_minutes, is_active FROM services WHERE id = ?', [id])
  if (!service) return { service: undefined, items: [] }
  const items = await execute('SELECT kind, code, label, amount, minutes, is_hourly FROM service_pricing_items WHERE service_id = ? ORDER BY kind, sort_order, id', [id])
  return { service, items }
}
