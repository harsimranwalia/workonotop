// One phone checks cleaners out of the job (ENG-016): the other end of the tick list. Whoever has access to the link may do it: a signed-in cleaner,
// the job's provider or an admin. A check-out is final for the assignment, and the last cleaner out of a running job pauses its timer in the same
// transaction. The phone's position is stored with each check-out when it sent a usable one and is never required. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute, withConnection } from '@/lib/db'
import { assignedCrew, raceMessage } from '@/lib/booking-crew'
import { CHECKIN_MESSAGES, checkOut } from '@/lib/job-checkin'
import { LINK_MESSAGES, findJobLink, resolveAccess } from '@/lib/job-link'
import { CODE_MESSAGES } from '@/lib/job-link-code'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function refusal(status, message) {
  return reply({ success: false, message }, status)
}

function notValid() {
  return refusal(404, LINK_MESSAGES.notValid)
}

// Public: the token in the path is the locator, and it is checked before anything else. Body { crew_ids, location: { latitude, longitude,
// accuracy } }. Refused in this order: no access (401, "Enter your code to continue."); a body that is not JSON (400); crew_ids not one to 30
// positive whole numbers (400); an id that is not on the crew now (400); an id that is not checked in now (409, nobody is checked out).
// 200 { success: true, data: { checked_out, crew, timer } }: the ids checked out by this request, the crew as the page shows it and the TimerView
// after it. A link in any other state, or a job that closed since the link was read, is the 404.
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

    const done = await checkOut({ withConnection, link, access, crewIds: body?.crew_ids, location: body?.location })
    if (done.ok) return reply({ success: true, data: { checked_out: done.checked_out, crew: done.crew, timer: done.timer } })
    switch (done.reason) {
      case 'closed':
        return notValid()
      case 'access':
        return refusal(401, CODE_MESSAGES.signIn)
      case 'not_on_crew':
        return refusal(400, CHECKIN_MESSAGES.notOnCrew)
      case 'not_checked_in':
        return refusal(409, CHECKIN_MESSAGES.notCheckedIn)
      default:
        return refusal(400, CHECKIN_MESSAGES.ids)
    }
  } catch (error) {
    const message = raceMessage(error)
    if (message) return refusal(409, message)
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a position.
    console.error('Error checking out of a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to check out')
  }
}
