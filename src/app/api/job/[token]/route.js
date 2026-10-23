// What the page behind a job link is shown (ENG-015). The link is a locator and opens nothing by itself: a visitor with no way in is told
// `access: 'none'` and nothing else, and the job comes only to a cleaner who has signed in with a texted code on this link, to the job's own
// provider, or to an admin. Every answer says no-store, the refusals and the errors too, so that no cache between this server and one phone
// keeps a page meant for the people on that job.

import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { assignedCrew } from '@/lib/booking-crew'
import { LINK_MESSAGES, findJobLink, jobPage, resolveAccess } from '@/lib/job-link'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// The one answer for a link that cannot be used, whatever the reason (malformed, unknown, switched off, job closed, job with no provider), so a
// stranger who tries tokens learns nothing about which ones exist or why one failed.
function notValid() {
  return reply({ success: false, message: LINK_MESSAGES.notValid }, 404)
}

// Public: the token in the path is the locator. 200 { success: true, data: { access: 'none' } } for a visitor with no way in, and nothing else in
// the body. For a caller with access, data is { access: 'cleaner' | 'provider' | 'admin', you: { kind, name }, job, crew, window, timer, photos,
// photo_can, photo_full }, built field by field in src/lib/job-link.js, which describes each part: job holds no customer, price or booking number;
// crew is names and ticks only. Access is judged again on every request. A link in any other state is the 404 above.
export async function GET(request, { params }) {
  const { token } = await params

  try {
    const link = await findJobLink(execute, token)
    if (!link) return notValid()

    const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true })
    const access = await resolveAccess(request, execute, link, crew)
    if (!access) return reply({ success: true, data: { access: 'none' } })

    const page = await jobPage(execute, link, access, crew)
    if (!page) return notValid()
    return reply({ success: true, data: page })
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement.
    console.error('Error reading a job link:', error?.code || error?.name)
    return reply({ success: false, message: 'Failed to load the job' }, 500)
  }
}
