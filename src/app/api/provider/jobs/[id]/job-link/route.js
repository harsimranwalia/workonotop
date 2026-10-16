// The job link of one job, for the provider (ENG-015): GET says whether there is a link, who is on the crew and whether each cleaner's number has
// been checked and whether they have ticked in, and POST creates, switches off or reissues the link. The job must be the caller's:
// bookings.provider_id is the caller, in any status, which is the one column that both "given to a provider" and "claimed by a provider" write.
// A job that is another provider's, one in the open pool, one that does not exist and an id that is not a number are all the same 404, and
// nothing about the job is read; 403 is never used for ownership, it would say the thing exists. The answers hold the link itself, so they say
// no-store, the refusals and the errors too.

import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { execute, withConnection } from '@/lib/db';
import { CREW_MESSAGES, idFromPath, raceMessage } from '@/lib/booking-crew';
import { LINK_MESSAGES, createJobLink, managedView, reissueLink, switchOffLink } from '@/lib/job-link';

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// The body of a refusal: { success, message } as the neighbouring routes answer.
function refusal(status, message) {
  return reply({ success: false, message }, status);
}

// What the library's refusals mean to the caller.
const REFUSALS = {
  not_found: [404, CREW_MESSAGES.jobNotFound],
  finished: [409, LINK_MESSAGES.finished],
  no_crew: [409, LINK_MESSAGES.noCrew],
  changed: [409, LINK_MESSAGES.changed],
};

const ACTIONS = { create: createJobLink, off: switchOffLink, reissue: reissueLink };

// Provider only. 200 { success: true, data: { job_link, status_open, crew, window } }: job_link is null or { path: '/job/{token}' (null while the
// link is off), on, generation, created_at, off_at }; status_open says whether the job can still change; crew is [{ id, name, number_state:
// 'checked' | 'unchecked' | 'cannot_text', checked_in, checked_in_at }] for the cleaners on the job now; window is the check-in window as the
// page shows it. The path is never a URL: the client adds its own origin.
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  // The refusal says no-store as every answer here does. The header goes on before the check so that the check reads `if (!auth.ok) return auth.response`.
  auth.response?.headers.set('Cache-Control', 'no-store');
  if (!auth.ok) return auth.response;
  const bookingId = idFromPath((await params).id);
  if (bookingId === null) return refusal(404, CREW_MESSAGES.jobNotFound);

  try {
    const view = await managedView(execute, { bookingId, providerId: auth.caller.id });
    if (!view) return refusal(404, CREW_MESSAGES.jobNotFound);
    return reply({ success: true, data: view });
  } catch (error) {
    console.error('Error reading a job link:', error?.code || error?.name);
    return refusal(500, 'Failed to load the job link');
  }
}

// Provider only. Body { action: 'create' | 'off' | 'reissue', generation? }. create makes the job's link (and brings an off one back as a new
// token), and is idempotent: a link that is on is returned as it is. off switches it off at once and ends every session made on it; it is
// idempotent and allowed on a finished job. reissue is a new token and a new generation, and needs the generation the caller last saw, so two
// people racing do not each end up holding a token the other killed. 200 { success: true, data: { job_link } }. 404 for a job that is not the
// caller's; 409 for a finished job (create, reissue), a job with nobody on its crew (create) and a generation that is not current (reissue), or
// a save that lost a race; 400 for a body that is not one of those.
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  // The refusal says no-store as every answer here does. The header goes on before the check so that the check reads `if (!auth.ok) return auth.response`.
  auth.response?.headers.set('Cache-Control', 'no-store');
  if (!auth.ok) return auth.response;
  const bookingId = idFromPath((await params).id);
  if (bookingId === null) return refusal(404, CREW_MESSAGES.jobNotFound);

  let body;
  try {
    body = await request.json();
  } catch {
    return refusal(400, 'Invalid request.');
  }
  const change = typeof body?.action === 'string' && Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (change === null) return refusal(400, 'Invalid request.');

  try {
    const done = await change({
      withConnection,
      bookingId,
      providerId: auth.caller.id,
      actor: { kind: 'provider', ref: auth.caller.id },
      generation: body.generation,
    });
    if (!done.ok) {
      const [status, message] = REFUSALS[done.reason];
      return refusal(status, message);
    }
    return reply({ success: true, data: { job_link: done.job_link } });
  } catch (error) {
    const message = raceMessage(error);
    if (message) return refusal(409, message);
    console.error('Error changing a job link:', error?.code || error?.name);
    return refusal(500, 'Failed to change the job link');
  }
}
