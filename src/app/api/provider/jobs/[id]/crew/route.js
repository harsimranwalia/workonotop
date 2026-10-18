// The crew on one job (ENG-014): GET says who is on it, PUT replaces the set. The job must be the caller's: bookings.provider_id is the caller,
// in any status, which is the one column that both "given to a provider" and "claimed by a provider" write. A job that is another provider's, one
// in the open pool, one nobody holds, one that does not exist and an id that is not a number are all the same 404, and nothing about the job is
// read. 403 is never used for ownership; it would say the thing exists. The crew members come from the caller's own list only.

import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { execute, withConnection } from '@/lib/db';
import { CREW_MESSAGES, assignedCrew, crewEditable, crewIdsOf, idFromPath, inTransaction, raceMessage, setBookingCrew } from '@/lib/booking-crew';
import { afterCommit } from '@/lib/notices';
import { noticeJobLink } from '@/lib/notice-events';

// The body of a refusal: { success, message } as the neighbouring routes answer.
function refusal(status, message) {
  return NextResponse.json({ success: false, message }, { status });
}

// What setBookingCrew's refusals mean to the caller.
const REFUSALS = {
  no_job: [404, CREW_MESSAGES.jobNotFound],
  finished: [409, CREW_MESSAGES.finished],
  unknown_member: [400, CREW_MESSAGES.ownCrew],
};

// Provider only. 200 { success: true, data: { crew: [{ id, name, phone, removed }], editable } }. editable says whether the crew can still be
// changed (the job is not finished); a member who was removed from the list is shown, marked, only on a job that cannot change.
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const bookingId = idFromPath((await params).id);
  if (bookingId === null) return refusal(404, CREW_MESSAGES.jobNotFound);

  try {
    const jobs = await execute('SELECT status FROM bookings WHERE id = ? AND provider_id = ?', [bookingId, auth.caller.id]);
    if (jobs.length === 0) return refusal(404, CREW_MESSAGES.jobNotFound);

    const crew = await assignedCrew(execute, bookingId);
    return NextResponse.json({ success: true, data: { crew, editable: crewEditable(jobs[0].status) } });
  } catch (error) {
    console.error('Error reading a job crew:', error?.code || error?.name);
    return refusal(500, 'Failed to load the crew');
  }
}

// Provider only. Body { crew_ids }: the whole crew the job should have now, as a list of the caller's own members' ids ([] for nobody). Saving the
// same list twice changes nothing the second time. 200 { success: true, data: { crew, added, removed } }: crew as in GET, added and removed the
// members who were put on and taken off by this save ([{ id, name, phone }]), so whatever is sent to a cleaner later goes to `added` only.
// 400 for a body that is not that list and for an id that is not an active member of the caller's crew (one answer for another provider's member,
// a removed one and one that does not exist), 404 for a job that is not the caller's, 409 for a job that is finished or a save that lost a race.
export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const bookingId = idFromPath((await params).id);
  if (bookingId === null) return refusal(404, CREW_MESSAGES.jobNotFound);

  let body;
  try {
    body = await request.json();
  } catch {
    return refusal(400, CREW_MESSAGES.ids);
  }
  const ids = crewIdsOf(body);
  if (!ids.ok) return refusal(400, CREW_MESSAGES.ids);

  try {
    const saved = await withConnection((connection) =>
      inTransaction(connection, (tx) => setBookingCrew(tx, bookingId, auth.caller.id, ids.ids))
    );
    if (!saved.ok) {
      const [status, message] = REFUSALS[saved.reason];
      return refusal(status, message);
    }
    // A cleaner put on the job is texted its link once this answer has gone, when the job has one that is on (ENG-018): the members `added` by this save and no
    // one else, so saving the same list again texts no one.
    if (saved.added.length > 0) afterCommit(() => noticeJobLink(execute, { bookingId, memberIds: saved.added.map((member) => member.id) }));
    return NextResponse.json({ success: true, data: { crew: saved.crew, added: saved.added, removed: saved.removed } });
  } catch (error) {
    const message = raceMessage(error);
    if (message) return refusal(409, message);
    console.error('Error saving a job crew:', error?.code || error?.name);
    return refusal(500, 'Failed to save the crew');
  }
}
