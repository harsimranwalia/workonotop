// One phone ticks a crew in at the job (ENG-015). Whoever has access to the link may do it: a signed-in cleaner, the job's provider or an admin,
// and all of them are held to the same window, which opens an hour before the first slot of the job. The phone's position is stored with each
// tick and the distance from the address is worked out; being far away is a flag the admin sees and never a refusal. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute, withConnection } from '@/lib/db'
import { assignedCrew, raceMessage } from '@/lib/booking-crew'
import { CHECKIN_MESSAGES, checkIn, opensMessage } from '@/lib/job-checkin'
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
// accuracy } }. Refused in this order: no access (401, "Enter your code to continue."); crew_ids not one to 30 positive whole numbers (400); the
// window not open (409, with opens_at and opens_label); the position missing or unusable (400); an id that is not on the crew now (400, nobody is
// ticked); an id that has checked out of this job (409, nobody is ticked: a check-out is final for the assignment). 200 { success: true, data: {
// checked_in, already, away, distance_m, crew } }: the ids ticked by this request and the ids that had been
// ticked already, whether the phone was more than 500 m from the address (null when the job has no position), that distance, and the crew as
// the page shows it. A link in any other state, or a job that closed since the link was read, is the 404.
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

    const ticked = await checkIn({ withConnection, link, access, crewIds: body?.crew_ids, location: body?.location })
    if (ticked.ok) {
      return reply({
        success: true,
        data: { checked_in: ticked.checked_in, already: ticked.already, away: ticked.away, distance_m: ticked.distance_m, crew: ticked.crew },
      })
    }
    switch (ticked.reason) {
      case 'closed':
        return notValid()
      case 'access':
        return refusal(401, CODE_MESSAGES.signIn)
      case 'window': {
        const message = opensMessage(ticked.opens_label)
        return reply({ success: false, message, opens_at: ticked.opens_at, opens_label: ticked.opens_label }, 409)
      }
      case 'location':
        return refusal(400, CHECKIN_MESSAGES.location)
      case 'not_on_crew':
        return refusal(400, CHECKIN_MESSAGES.notOnCrew)
      case 'checked_out':
        return refusal(409, CHECKIN_MESSAGES.checkedOut)
      default:
        return refusal(400, CHECKIN_MESSAGES.ids)
    }
  } catch (error) {
    const message = raceMessage(error)
    if (message) return refusal(409, message)
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a position.
    console.error('Error checking in at a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to check in')
  }
}
