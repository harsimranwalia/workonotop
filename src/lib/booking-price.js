// The price of record of a booking, and the provider's payout for it.
// The price is the catalog's base price of the booked service, read on the server when the job is booked and stored
// in bookings.service_price. The payout is that recorded price less the booking's commission percent (20 when none is
// set), to the cent. Every route that charges a customer or pays a provider takes its amount from here.

export const DEFAULT_COMMISSION_PERCENT = 20

// A services row as the routes read it (is_active, base_price, additional_price). Answers the price and the hourly rate the
// catalog offers it at, or null when the catalog does not offer it: no row, not active, or a base price that is not a
// number above 0. A missing or non-numeric hourly rate is 0.
export function catalogPrice(service) {
  if (!service || Number(service.is_active) !== 1) return null
  const price = Number(service.base_price)
  if (!Number.isFinite(price) || price <= 0) return null
  const rate = Number(service.additional_price)
  return { price, rate: Number.isFinite(rate) && rate > 0 ? rate : 0 }
}

// The booking's own commission percent, or the default when it has none. NULL and '' are none; "0.00" is 0.
export function commissionPercentOf(booking) {
  const stored = booking ? booking.commission_percent : null
  if (stored === null || stored === undefined || String(stored).trim() === '') return DEFAULT_COMMISSION_PERCENT
  const percent = Number(stored)
  return Number.isFinite(percent) ? percent : DEFAULT_COMMISSION_PERCENT
}

// The provider's payout for a booking row: its recorded price less its commission percent, to the cent.
export function providerPayout(booking) {
  const price = Number(booking ? booking.service_price : NaN)
  if (!Number.isFinite(price)) return 0
  return parseFloat((price * (1 - commissionPercentOf(booking) / 100)).toFixed(2))
}
