// An on-site report is sent from the job link (ENG-017): one of five one-tap reports, a note and a photo. Whoever has access to the link may send one: a
// cleaner who is signed in and checked in, the job's provider or an admin. The report waits on the office; nothing is charged. Once the answer has gone,
// the job's provider and each admin are told by text and by e-mail that a report came in (ENG-018), by the notice and not by this route's own code, and
// only for a report this call saved: a send repeated with the same client_token tells no one more. The notice names the job and one of the five types,
// never the note or the photo. The server decides what the file is from its bytes and never from the name or the type the sender gave it. The phone's
// position is recorded when it is usable and is never a reason to refuse a report. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute, withConnection } from '@/lib/db'
import { assignedCrew, raceMessage } from '@/lib/booking-crew'
import { LINK_MESSAGES, findJobLink, resolveAccess } from '@/lib/job-link'
import { CODE_MESSAGES } from '@/lib/job-link-code'
import { PHOTO_MAX_BYTES } from '@/lib/job-photo-store'
import { REPORT_MESSAGES, reportsFor, saveReport } from '@/lib/job-reports'
import { afterCommit } from '@/lib/notices'
import { noticeReport } from '@/lib/notice-events'
import { readCappedBody } from '@/lib/read-capped-body'

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function refusal(status, message) {
  return reply({ success: false, message }, status)
}

function notValid() {
  return refusal(404, LINK_MESSAGES.notValid)
}

// The phone's position as the form carries it: text fields, turned into numbers here and judged by saveReport. Null when the phone sent neither a
// latitude nor a longitude. A field that is empty counts as not sent, so an empty accuracy is not read as an accuracy of nothing.
function positionFrom(form) {
  const [latitude, longitude, accuracy] = ['latitude', 'longitude', 'accuracy'].map((name) => {
    const value = form.get(name)
    return typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined
  })
  return latitude === undefined && longitude === undefined ? null : { latitude, longitude, accuracy }
}

// Public: the token in the path is the locator, and it is checked before anything else, and before a byte of the body is read. Body:
// multipart/form-data with `type` (one of the five), `note` (1 to 1,000 characters), `photo` (one file) and, optionally, `client_token` (the phone's
// own mark on this send, so that a send made again after a lost answer is answered with the report it saved and writes nothing) and `latitude`,
// `longitude` and `accuracy`. The body is read through a counter that stops at PHOTO_MAX_BYTES, because a Content-Length can be missing or false, and
// it is parsed only if all of it fit. Refused in this order: no access (401, "Enter your code to continue."); a body that is not multipart/form-data
// (400, "Invalid request."); a body past PHOTO_MAX_BYTES (413, nothing more is read); a body that does not parse or has no file, or a client_token
// that is not a token (400); a type that is none of the five (400); a note that is empty or too long (400); bytes that are not a JPEG, PNG or WebP
// (400); a cleaner who is not checked in (409); a job that is not confirmed or in progress (409); the most reports a job may have (409); a store that
// cannot write (503). 200 { success: true, data: { report, reports, again } }: the report as kept ({ id, type, label, note, photo, by, at, seen }),
// every report of the job as the page lists them, and whether this was a send already saved. A link in any other state, or a job that closed since
// the link was read, is the 404.
export async function POST(request, { params }) {
  const { token } = await params

  try {
    const link = await findJobLink(execute, token)
    if (!link) return notValid()

    const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true })
    const access = await resolveAccess(request, execute, link, crew)
    if (!access) return refusal(401, CODE_MESSAGES.signIn)

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) return refusal(400, 'Invalid request.')

    const body = await readCappedBody(request, PHOTO_MAX_BYTES)
    if (!body.ok) return refusal(413, REPORT_MESSAGES.tooBig)

    let form
    try {
      form = await new Response(body.bytes, { headers: { 'content-type': contentType } }).formData()
    } catch {
      return refusal(400, 'Invalid request.')
    }
    const file = form.get('photo')
    if (!file || typeof file === 'string') return refusal(400, 'Invalid request.')
    const type = form.get('type')
    const note = form.get('note')
    const sent = form.get('client_token')
    if (sent !== null && typeof sent !== 'string') return refusal(400, 'Invalid request.')

    const saved = await saveReport({
      withConnection,
      link,
      access,
      type: typeof type === 'string' ? type : null,
      note: typeof note === 'string' ? note : null,
      bytes: Buffer.from(await file.arrayBuffer()),
      location: positionFrom(form),
      clientToken: sent === null || sent === '' ? null : sent,
    })
    if (saved.ok) {
      if (!saved.again) afterCommit(() => noticeReport(execute, { reportId: saved.report.id }))
      return reply({ success: true, data: { report: saved.report, reports: await reportsFor(execute, link.booking_id), again: saved.again } })
    }
    switch (saved.reason) {
      case 'closed':
        return notValid()
      case 'access':
        return refusal(401, CODE_MESSAGES.signIn)
      case 'token':
        return refusal(400, 'Invalid request.')
      case 'type':
        return refusal(400, REPORT_MESSAGES.type)
      case 'note':
        return refusal(400, REPORT_MESSAGES.note)
      case 'photo':
        return refusal(400, REPORT_MESSAGES.photo)
      case 'image':
        return refusal(400, REPORT_MESSAGES.image)
      case 'too_big':
        return refusal(413, REPORT_MESSAGES.tooBig)
      case 'not_here':
        return refusal(409, REPORT_MESSAGES.notHere)
      case 'status':
        return refusal(409, REPORT_MESSAGES.status)
      case 'too_many':
        return refusal(409, REPORT_MESSAGES.tooMany)
      default:
        return refusal(503, REPORT_MESSAGES.store)
    }
  } catch (error) {
    const message = raceMessage(error)
    if (message) return refusal(409, message)
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a note or a position.
    console.error('Error sending a report at a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to send the report')
  }
}
