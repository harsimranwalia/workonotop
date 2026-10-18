// The office's queue of on-site reports (ENG-017). Admin only; the reports waiting on the office are the ones nobody has decided and the approved ones
// whose charge has not gone through. The admin page asks this on a timer and on focus; nothing is sent from here. Every answer says no-store.

import { NextResponse } from 'next/server'
import { requireCaller } from '@/lib/api-auth'
import { execute } from '@/lib/db'
import { REPORT_LIST_LIMIT, queueFor } from '@/lib/report-desk'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// A positive whole number written as digits, or null. Anything looser would reach SQL, where MySQL reads '5abc' as 5.
function idOf(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

// Admin only. `?status=open|all` (open when absent), `booking_id` (one job's reports), `before` (the id the page after starts below) and `limit`
// (20 when absent, held to 50). 200 { success: true, data: { reports, open_count, next_before } }: the reports newest first, as the desk shows
// them, the count of the reports waiting on the office whatever the filter, and the id to ask `before` from when more remain, else null. A status
// outside the two, or an id or limit that is not a positive whole number, is a 400.
export async function GET(request) {
  const auth = await requireCaller(request, ['admin'])
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') ?? 'open'
    if (status !== 'open' && status !== 'all') return reply({ success: false, message: 'Invalid request.' }, 400)
    const wanted = {}
    for (const [name, key] of [['booking_id', 'bookingId'], ['before', 'before'], ['limit', 'limit']]) {
      const raw = searchParams.get(name)
      if (raw === null) continue
      wanted[key] = idOf(raw)
      if (wanted[key] === null) return reply({ success: false, message: 'Invalid request.' }, 400)
    }
    if (wanted.limit !== undefined) wanted.limit = Math.min(wanted.limit, REPORT_LIST_LIMIT.max)

    return reply({ success: true, data: await queueFor(execute, { status, ...wanted }) })
  } catch (error) {
    console.error('Error reading the report queue:', error?.code || error?.name)
    return reply({ success: false, message: 'Failed to load the reports' }, 500)
  }
}
