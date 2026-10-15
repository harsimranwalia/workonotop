// The job timer on the job link (ENG-016). GET is the poll: the TimerView, worked out from the rows at the moment it is asked. POST starts, pauses
// or resumes the job. Whoever has access to the link may do either: a signed-in cleaner, the job's provider or an admin; a cleaner must be checked
// in to act, and a start needs a before photo, somebody checked in and the phone's position. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute, withConnection } from '@/lib/db'
import { assignedCrew, raceMessage } from '@/lib/booking-crew'
import { LINK_MESSAGES, findJobLink, resolveAccess } from '@/lib/job-link'
import { CODE_MESSAGES } from '@/lib/job-link-code'
import { TIMER_MESSAGES, pauseJob, refreshTimer, resumeJob, startJob } from '@/lib/job-timer'

const ACTIONS = { start: startJob, pause: pauseJob, resume: resumeJob }

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function refusal(status, message) {
  return reply({ success: false, message }, status)
}

function notValid() {
  return refusal(404, LINK_MESSAGES.notValid)
}

// Public: the token in the path is the locator, and it is checked before anything else. 404 for a link that cannot be used, 401 ("Enter your code to
// continue.") for no access. 200 { success: true, data: { timer } }: the TimerView (state, quote_minutes, crew_here, server_now, used_seconds,
// clock_seconds, over_seconds, over_quote_at, per_member, can, blocked). Looking also does what a look owes the record: a cleaner taken off the
// crew while checked in is checked out, and the first look that finds the quote used up flags the job. Nothing is billed.
export async function GET(request, { params }) {
  const { token } = await params

  try {
    const link = await findJobLink(execute, token)
    if (!link) return notValid()

    const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true })
    const access = await resolveAccess(request, execute, link, crew)
    if (!access) return refusal(401, CODE_MESSAGES.signIn)

    const timer = await refreshTimer(execute, link, { kind: access.kind, ref: access.ref })
    if (!timer) return notValid()
    return reply({ success: true, data: { timer } })
  } catch (error) {
    console.error('Error reading the timer of a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to load the timer')
  }
}

// Public, as above. Body { action: 'start' | 'pause' | 'resume', location: { latitude, longitude, accuracy } }. Refused in this order: no access
// (401); a body that is not JSON or an action that is not one of the three (400); then the job's own refusals as 409 { success: false, message,
// reason }: not_here, already_started, not_confirmed, no_before_photos, nobody_here, not_running, not_paused; a start without a usable position is
// 400 with TIMER_MESSAGES.location. 200 { success: true, data: { timer } } after the change. A link in any other state, or a job that closed since
// the link was read, is the 404.
export async function POST(request, { params }) {
  const { token } = await params

  try {
    const link = await findJobLink(execute, token)
    if (!link) return notValid()

    const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true })
    const access = await resolveAccess(request, execute, link, crew)
    if (!access) return refusal(401, CODE_MESSAGES.signIn)

    let body
    try {
      body = await request.json()
    } catch {
      return refusal(400, 'Invalid request.')
    }
    const act = Object.hasOwn(ACTIONS, body?.action) ? ACTIONS[body.action] : null
    if (!act) return refusal(400, 'Invalid request.')

    const done = await act({ withConnection, link, access, location: body.location })
    if (done.ok) return reply({ success: true, data: { timer: done.timer } })
    switch (done.reason) {
      case 'closed':
        return notValid()
      case 'access':
        return refusal(401, CODE_MESSAGES.signIn)
      case 'location':
        return refusal(400, TIMER_MESSAGES.location)
      default:
        return reply({ success: false, message: TIMER_MESSAGES[done.reason], reason: done.reason }, 409)
    }
  } catch (error) {
    const message = raceMessage(error)
    if (message) return refusal(409, message)
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a position.
    console.error('Error changing the timer of a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to change the timer')
  }
}
