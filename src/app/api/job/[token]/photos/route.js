// A before or an after photo is added at the job (ENG-016). Whoever has access to the link may add one: a cleaner who is signed in and checked
// in, the job's provider or an admin. The server decides what the file is from its bytes and never from the name or the type the sender gave it,
// stores it under a name of its own and, with it, who took it. The phone's position is recorded with the photo when it is usable and is never a
// reason to refuse one. Every answer says no-store.

import { NextResponse } from 'next/server'
import { execute, withConnection } from '@/lib/db'
import { assignedCrew, raceMessage } from '@/lib/booking-crew'
import { LINK_MESSAGES, findJobLink, resolveAccess } from '@/lib/job-link'
import { CODE_MESSAGES } from '@/lib/job-link-code'
import { PHOTO_MAX_BYTES } from '@/lib/job-photo-store'
import { PHOTO_MESSAGES, addPhoto, photosFor } from '@/lib/job-photos'
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

// The phone's position as the form carries it: text fields, turned into numbers here and judged by addPhoto. Null when the phone sent neither a
// latitude nor a longitude. A field that is empty counts as not sent, so an empty accuracy is not read as an accuracy of nothing.
function positionFrom(form) {
  const [latitude, longitude, accuracy] = ['latitude', 'longitude', 'accuracy'].map((name) => {
    const value = form.get(name)
    return typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined
  })
  return latitude === undefined && longitude === undefined ? null : { latitude, longitude, accuracy }
}

// Public: the token in the path is the locator, and it is checked before anything else, and before a byte of the body is read. Body:
// multipart/form-data with `type` ('before' or 'after'), `photo` (one file) and, optionally, `latitude`, `longitude` and `accuracy`. The body is
// read through a counter that stops at PHOTO_MAX_BYTES, because a Content-Length can be missing or false, and it is parsed only if all of it fit.
// Refused in this order: no access (401, "Enter your code to continue."); a body that is not multipart/form-data (400, "Invalid request.");
// a body past PHOTO_MAX_BYTES (413, nothing more is read); a body that does not parse or has no file (400); a type that is neither (400); bytes
// that are not a JPEG, PNG or WebP (400); a cleaner who is not checked in (409); a before photo once the job has started, or an after photo before
// it has (409); the most photos of that type a job may have (409); a store that cannot write (503). 200 { success: true, data: { photo, photos } }:
// the photo as kept ({ id, type, url, taken_by, taken_at }) and every photo of the job as the page lists them. A link in any other state, or a job
// that closed since the link was read, is the 404.
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
    if (!body.ok) return refusal(413, PHOTO_MESSAGES.tooBig)

    let form
    try {
      form = await new Response(body.bytes, { headers: { 'content-type': contentType } }).formData()
    } catch {
      return refusal(400, 'Invalid request.')
    }
    const file = form.get('photo')
    if (!file || typeof file === 'string') return refusal(400, 'Invalid request.')
    const type = form.get('type')

    const added = await addPhoto({
      withConnection,
      link,
      access,
      type: typeof type === 'string' ? type : null,
      bytes: Buffer.from(await file.arrayBuffer()),
      location: positionFrom(form),
    })
    if (added.ok) return reply({ success: true, data: { photo: added.photo, photos: await photosFor(execute, link.booking_id) } })
    switch (added.reason) {
      case 'closed':
        return notValid()
      case 'access':
        return refusal(401, CODE_MESSAGES.signIn)
      case 'type':
        return refusal(400, PHOTO_MESSAGES.type)
      case 'image':
        return refusal(400, PHOTO_MESSAGES.image)
      case 'too_big':
        return refusal(413, PHOTO_MESSAGES.tooBig)
      case 'not_here':
        return refusal(409, PHOTO_MESSAGES.notHere)
      case 'started':
        return refusal(409, PHOTO_MESSAGES.started)
      case 'not_started':
        return refusal(409, PHOTO_MESSAGES.notStarted)
      case 'too_many':
        return refusal(409, PHOTO_MESSAGES.tooMany)
      default:
        return refusal(503, PHOTO_MESSAGES.store)
    }
  } catch (error) {
    const message = raceMessage(error)
    if (message) return refusal(409, message)
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement, and here that is a position.
    console.error('Error adding a photo at a job link:', error?.code || error?.name)
    return refusal(500, 'Failed to add the photo')
  }
}
