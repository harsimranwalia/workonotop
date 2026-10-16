// The live price of a job for an admin who is booking on a customer's behalf (ENG-013). It answers as POST /api/pricing does, with one
// difference: a job whose answers the pricing rule would send to a quote is priced from the service's rows all the same, and the picks that
// would have sent it there come back as quote_flags, so the screen can say that the job is normally a quote. Admin only and read-only. It is
// one of exactly two routes that may price past a quote; the other is POST /api/admin/bookings, which records the price this one shows.

import { NextResponse } from 'next/server'
import { requireCaller } from '@/lib/api-auth'
import { execute } from '@/lib/db'
import { loadPricing, priceJobPastQuote, refusalOf } from '@/lib/pricing-rules'

// Said by this route and by POST /api/admin/bookings alike: a price for repeating visits would be one the next step refuses.
const REPEATING_REFUSED = "Repeating visits can't be booked on a customer's behalf yet."

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// The service's choices as the booking screen reads them. The threshold that sends a job to a quote (quote_from) is not one of them.
const choicesOf = (items) => items.map((item) => ({ kind: item.kind, code: item.code, label: item.label, amount: item.amount, minutes: item.minutes, is_hourly: item.is_hourly }))

// Body: { service_id, answers }. Answers the price, the quoted minutes, the lines the price is made of, the service's choices and quote_flags
// (the picks that make the job a quote for a customer: [] when none do), or a 400 that names the answer that cannot be priced. Nothing is
// written. Answers that carry a frequency are a 400 on the field 'frequency', because the booking route does not take repeating visits on a
// customer's behalf, so there are no visits in the answer either.
export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 })
  }
  if (!isPlainObject(body)) return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 })

  try {
    const { service_id, answers } = body
    if (answers?.frequency != null) {
      return NextResponse.json({ success: false, message: REPEATING_REFUSED, field: 'frequency' }, { status: 400 })
    }

    const { service, items, discounts } = await loadPricing(execute, service_id)
    const job = priceJobPastQuote(service, items, answers, discounts)
    if (!job.ok) return NextResponse.json(refusalOf(job), { status: 400 })

    return NextResponse.json({
      success: true,
      service_id: service.id,
      price: job.price,
      quoted_minutes: job.minutes,
      lines: job.lines,
      quote_flags: job.quote_flags,
      choices: choicesOf(items),
    })
  } catch (error) {
    console.error('Error working out the price:', error)
    return NextResponse.json({ success: false, message: 'Failed to work out the price' }, { status: 500 })
  }
}
