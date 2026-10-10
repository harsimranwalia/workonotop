// The live price of a job: the service's pricing rule applied to the answers given. Public, like the catalog, and read-only.

import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { loadPricing, priceJob, refusalOf } from '@/lib/pricing-rules'

// Body: { service_id, answers }. Answers the price, the quoted minutes, the lines the price is made of and the service's choices (the
// items of its rule), or a 400 that names the answer that cannot be priced. Nothing is written.
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 })
  }

  try {
    const { service_id, answers } = body || {}
    const { service, items } = await loadPricing(execute, service_id)
    const job = priceJob(service, items, answers)
    if (!job.ok) return NextResponse.json(refusalOf(job), { status: 400 })

    return NextResponse.json({
      success: true,
      service_id: service.id,
      price: job.price,
      quoted_minutes: job.minutes,
      lines: job.lines,
      choices: items.map((item) => ({ kind: item.kind, code: item.code, label: item.label, amount: item.amount, minutes: item.minutes, is_hourly: item.is_hourly })),
    })
  } catch (error) {
    console.error('Error working out the price:', error)
    return NextResponse.json({ success: false, message: 'Failed to work out the price' }, { status: 500 })
  }
}
