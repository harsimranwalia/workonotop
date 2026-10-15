// A cleaner asks for a code to open a job link (ENG-015). The body is the mobile number the provider has for them. Whatever the number was, the
// answer is the same, so the page can neither confirm nor deny that a number is on the crew: the difference between a number that is texted and
// one that is not is only in the record of events. The only answers that differ are a link that has been asked too often and a value that is not
// a number at all. The text goes through sendSMS, which refuses a number that is not Canadian. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { sendSMS } from '@/lib/sms'
import { LINK_MESSAGES, findJobLink } from '@/lib/job-link'
import { CODE_MESSAGES, requestCode } from '@/lib/job-link-code'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function notValid() {
  return reply({ success: false, message: LINK_MESSAGES.notValid }, 404)
}

// Public: the token in the path is the locator, and it is checked before the body is read. Body { phone }. 200 { success: true, data: { requested:
// true } } whatever the number was. 429 when the link has been asked too often; 400 with a message when phone is not a number. A body that is not
// JSON is a 400. A link in any other state is the 404.
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

    const asked = await requestCode({ execute, sendText: sendSMS, link, rawPhone: body?.phone })
    if (asked.status === 'limited') return reply({ success: false, message: CODE_MESSAGES.limited }, 429)
    if (asked.status === 'invalid') return reply({ success: false, message: asked.message }, 400)
    return reply({ success: true, data: { requested: true } })
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a number.
    console.error('Error asking for a job link code:', error?.code || error?.name)
    return reply({ success: false, message: 'Failed to send the code' }, 500)
  }
}
