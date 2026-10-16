// A cleaner gives back the code they were texted (ENG-015). The right code for the number, on this link, buys a session for this link only: a
// cookie that holds a random value and nothing else, of which the database keeps only the hash. A wrong code, an expired one, one used up and a
// number that is on no crew are one answer, so a stranger learns nothing from what they are told. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { LINK_MESSAGES, findJobLink } from '@/lib/job-link'
import { CODE_MESSAGES, sessionCookie, verifyCode } from '@/lib/job-link-code'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function notValid() {
  return reply({ success: false, message: LINK_MESSAGES.notValid }, 404)
}

// Public: the token in the path is the locator, and it is checked before the body is read. Body { phone, code }. 200 { success: true, data:
// { signed_in: true } } and the session cookie for this link. 429 when the link has been tried too often; 400 for every other failure, with the
// one sentence in CODE_MESSAGES.failed. A body that is not JSON is a 400. A link in any other state is the 404.
export async function POST(request, { params }) {
  const { token } = await params

  try {
    const link = await findJobLink(execute, token)
    if (!link) return notValid()

    let body
    try {
      body = await request.json()
    } catch {
      return reply({ success: false, message: 'Invalid request.' }, 400)
    }

    const verified = await verifyCode({ execute, link, rawPhone: body?.phone, code: body?.code })
    if (verified.status === 'limited') return reply({ success: false, message: CODE_MESSAGES.limited }, 429)
    if (verified.status !== 'signed_in') return reply({ success: false, message: CODE_MESSAGES.failed }, 400)

    const response = reply({ success: true, data: { signed_in: true } })
    response.cookies.set(sessionCookie(link, verified.session))
    return response
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a number or a code.
    console.error('Error signing in to a job link:', error?.code || error?.name)
    return reply({ success: false, message: 'Failed to check the code' }, 500)
  }
}
