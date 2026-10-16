// The live price of a job: the service's pricing rule applied to the answers given. Public, like the catalog, and read-only.

import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { loadPricing, priceJob, priceVisits, refusalOf } from '@/lib/pricing-rules'

// The service's choices as the booking screen reads them. The threshold that sends a job to a quote (quote_from) is not one of them.
const choicesOf = (items) => items.map((item) => ({ kind: item.kind, code: item.code, label: item.label, amount: item.amount, minutes: item.minutes, is_hourly: item.is_hourly }))

// Body: { service_id, answers }. Answers the price, the quoted minutes, the lines the price is made of and the service's choices (the
// items of its rule), or a 400 that names the answer that cannot be priced. Nothing is written. When the answers carry a frequency and a
// date, the answer also holds `visits`: the date, price and lines of each visit of the series, the first visit being the one priced above.
// A job that needs a quote is not a refusal: it is a 200 with `quote_required: true`, the `flags` (the picks that send it to a quote) and
// the choices, and no price, minutes, lines or visits, so the booking screen can say so, offer the quote request and change its answers.
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 })
  }

  try {
    const { service_id, answers } = body || {}
    const { service, items, discounts } = await loadPricing(execute, service_id)
    const job = priceJob(service, items, answers, discounts)
    if (!job.ok && job.reason === 'quote') {
      return NextResponse.json({ success: true, quote_required: true, service_id: service.id, flags: job.flags, choices: choicesOf(items) })
    }
    if (!job.ok) return NextResponse.json(refusalOf(job), { status: 400 })

    let visits
    if (answers?.frequency != null && answers?.date != null) {
      const priced = priceVisits(service, items, answers, discounts)
      if (!priced.ok) return NextResponse.json(refusalOf(priced), { status: 400 })
      visits = priced.visits.map((visit) => ({ date: visit.date, price: visit.price, lines: visit.lines }))
    }

    return NextResponse.json({
      success: true,
      service_id: service.id,
      price: job.price,
      quoted_minutes: job.minutes,
      lines: job.lines,
      choices: choicesOf(items),
      ...(visits ? { visits } : {}),
    })
  } catch (error) {
    console.error('Error working out the price:', error)
    return NextResponse.json({ success: false, message: 'Failed to work out the price' }, { status: 500 })
  }
}
