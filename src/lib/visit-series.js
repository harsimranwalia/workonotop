// The visits of a booking that repeats: how often it can repeat, the date of each visit, and the time label of each. Each visit is a job of its
// own. Nothing here reads the clock, a time zone or the database, so that every caller gets the same dates from the same start.

import { dayLabel } from './booking-answers.js'

// How a booking can repeat: the visits it makes, the days between two visits (a month is a calendar month, so monthly has none) and the
// name the customer reads.
export const FREQUENCIES = {
  weekly: { visits: 12, days: 7, label: 'Weekly' },
  every_2_weeks: { visits: 6, days: 14, label: 'Every 2 weeks' },
  monthly: { visits: 3, label: 'Monthly' },
}

// The most visits any frequency makes.
export const MAX_VISITS = Math.max(...Object.values(FREQUENCIES).map((frequency) => frequency.visits))

const pad = (number, length) => String(number).padStart(length, '0')

// The last day number of a month (monthIndex 0 is January; 12 is January of the next year).
function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

// The dates of the visits of a booking that starts on `start` ('YYYY-MM-DD') and repeats at `frequency`, the start first, each as 'YYYY-MM-DD';
// null when the frequency is not a key of FREQUENCIES, when the start is not a real day, or when a visit would fall after year 9999. They are
// worked from the date's own numbers in UTC, as weekdayOf does, so that no time zone plays a part. A frequency with days puts each visit that
// many days after the one before. A monthly visit falls on the start's day of the month, counted from the start, or on the last day of a month
// that is shorter: starting on Jan 31 the visits are Jan 31, Feb 28 and Mar 31.
export function visitDates(frequency, start) {
  if (!Object.keys(FREQUENCIES).includes(frequency)) return null
  const parts = typeof start === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(start) : null
  if (!parts) return null
  const [year, month, date] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const first = new Date(Date.UTC(year, month - 1, date))
  if (first.getUTCFullYear() !== year || first.getUTCMonth() !== month - 1 || first.getUTCDate() !== date) return null

  const { visits, days } = FREQUENCIES[frequency]
  const dates = []
  for (let visit = 0; visit < visits; visit++) {
    const when = days === undefined
      ? new Date(Date.UTC(year, month - 1 + visit, Math.min(date, daysInMonth(year, month - 1 + visit))))
      : new Date(Date.UTC(year, month - 1, date + visit * days))
    if (when.getUTCFullYear() > 9999) return null
    dates.push(`${pad(when.getUTCFullYear(), 4)}-${pad(when.getUTCMonth() + 1, 2)}-${pad(when.getUTCDate(), 2)}`)
  }
  return dates
}

// The time label of the visit on `date` ('YYYY-MM-DD'), from the label of the first visit, which is 'Oct 17: Morning & Afternoon' as the booking
// step builds it: the same time names after the visit's own day, 'Oct 24: Morning & Afternoon'. A label with no ': ' is all time names.
export function visitSlot(slotText, date) {
  const text = typeof slotText === 'string' ? slotText : ''
  const at = text.indexOf(': ')
  return `${dayLabel(date)}: ${at === -1 ? text : text.slice(at + 2)}`
}
