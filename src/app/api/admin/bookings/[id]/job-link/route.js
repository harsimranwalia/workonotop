// A booking's job link, for the admin (ENG-015): GET says what the provider's view says and, besides, who ticked in and what has happened on the
// link; POST creates, switches off or reissues it, as the provider can. An admin can act on any booking that exists. The answers hold the link
// itself and who was where, so they say no-store, the refusals and the errors too.

import { NextResponse } from 'next/server'
import { requireCaller } from '@/lib/api-auth'
import { execute, withConnection } from '@/lib/db'
import { raceMessage } from '@/lib/booking-crew'
import { LINK_MESSAGES, createJobLink, managedView, reissueLink, switchOffLink } from '@/lib/job-link'
import { afterCommit } from '@/lib/notices'
import { noticeJobLink } from '@/lib/notice-events'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// The body of a refusal: { success, message } as the neighbouring routes answer.
function refusal(status, message) {
  return reply({ success: false, message }, status)
}

// The booking id of the path as a number, or null when it is not a positive whole number written as digits. Anything looser would reach SQL,
// where MySQL reads '5abc' as 5 and '1e3' as 1000.
function bookingIdOf(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

const NOT_FOUND = 'Booking not found'

// What the library's refusals mean to the caller.
const REFUSALS = {
  not_found: [404, NOT_FOUND],
  finished: [409, LINK_MESSAGES.finished],
  no_crew: [409, LINK_MESSAGES.noCrew],
  changed: [409, LINK_MESSAGES.changed],
}

const ACTIONS = { create: createJobLink, off: switchOffLink, reissue: reissueLink }

// Admin only. 200 { success: true, data: { job_link, status_open, crew, window, timer, photos, checkins, events } }: the first six as the provider's
// GET answers them; checkins is [{ crew_member_id, name, checked_in_at, checked_out_at, by: { kind, name }, away, distance_m, accuracy_m }] for the
// ticks that count, with away null when the booking has no position to compare; events is the last 100 things that happened on the link
// (EVENT_LIST_LIMIT in src/lib/job-link-base.js), newest first: [{ id, kind, actor: { kind, name }, subject, detail, latitude, longitude,
// accuracy_m, created_at }], with names as of the read and an erased cleaner as "A former cleaner". No number and no code is in the answer.
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin'])
  // The refusal says no-store as every answer here does. The header goes on before the check so that the check reads `if (!auth.ok) return auth.response`.
  auth.response?.headers.set('Cache-Control', 'no-store')
  if (!auth.ok) return auth.response
  const bookingId = bookingIdOf((await params).id)
  if (bookingId === null) return refusal(404, NOT_FOUND)

  try {
    const view = await managedView(execute, { bookingId, audit: true, actor: { kind: 'admin', ref: auth.caller.id } })
    if (!view) return refusal(404, NOT_FOUND)
    return reply({ success: true, data: view })
  } catch (error) {
    console.error('Error reading a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to load the job link')
  }
}

// Admin only. Body { action: 'create' | 'off' | 'reissue', generation? }, and the answers are the provider route's: 200 { success: true, data: {
// job_link } }; 404 for a booking that does not exist; 409 for a finished job (create, reissue), a job with nobody on its crew (create) and a
// generation that is not current (reissue), or a save that lost a race; 400 for a body that is not one of those. Once the answer has gone, create and
// reissue text the link to each cleaner on the crew whose number is checked, as the provider's route does (ENG-018); off texts no one.
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['admin'])
  // The refusal says no-store as every answer here does. The header goes on before the check so that the check reads `if (!auth.ok) return auth.response`.
  auth.response?.headers.set('Cache-Control', 'no-store')
  if (!auth.ok) return auth.response
  const bookingId = bookingIdOf((await params).id)
  if (bookingId === null) return refusal(404, NOT_FOUND)

  let body
  try {
    body = await request.json()
  } catch {
    return refusal(400, 'Invalid request.')
  }
  const change = typeof body?.action === 'string' && Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null
  if (change === null) return refusal(400, 'Invalid request.')

  try {
    const done = await change({
      withConnection,
      bookingId,
      actor: { kind: 'admin', ref: auth.caller.id },
      generation: body.generation,
    })
    if (!done.ok) {
      const [status, message] = REFUSALS[done.reason]
      return refusal(status, message)
    }
    if (body.action !== 'off') afterCommit(() => noticeJobLink(execute, { bookingId }))
    return reply({ success: true, data: { job_link: done.job_link } })
  } catch (error) {
    const message = raceMessage(error)
    if (message) return refusal(409, message)
    console.error('Error changing a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to change the job link')
  }
}
