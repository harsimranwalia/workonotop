// One member of a provider's crew (ENG-014): PATCH corrects the name or the number, DELETE removes the member. Only the caller's own active
// members can be reached: one that is another provider's, one that was removed, one that does not exist and an id that is not a number are all
// the same 404, so the answer does not say which ids exist. 403 is never used for ownership; it would say the thing exists.

import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { withConnection } from '@/lib/db';
import { normalisePhone } from '@/lib/phone';
import { CREW_MESSAGES, editMember, idFromPath, inTransaction, normaliseName, raceMessage, removeMember } from '@/lib/booking-crew';

// The body of a refusal: { success, message } as the neighbouring routes answer.
function refusal(status, message) {
  return NextResponse.json({ success: false, message }, { status });
}

// Provider only. Body { name?, phone? }, at least one. 200 { success: true, data: { member: { id, name, phone } } }; the number is read again by
// normalisePhone. 400 for a rule broken or neither field, 404 for a member that is not the caller's active one, 409 for a number that another entry
// of the caller's already has, removed entries included.
export async function PATCH(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const memberId = idFromPath((await params).id);
  if (memberId === null) return refusal(404, CREW_MESSAGES.memberNotFound);

  let body;
  try {
    body = await request.json();
  } catch {
    return refusal(400, 'Send a name or a number to change, as a JSON body.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refusal(400, 'Send a name or a number to change, as a JSON body.');

  const changes = {};
  if (body.name !== undefined) {
    const name = normaliseName(body.name);
    if (!name.ok) return refusal(400, name.message);
    changes.name = name.name;
  }
  if (body.phone !== undefined) {
    const phone = normalisePhone(body.phone);
    if (!phone.ok) return refusal(400, phone.message);
    changes.phone = phone.phone;
  }
  if (changes.name === undefined && changes.phone === undefined) return refusal(400, 'Send a name or a number to change.');

  try {
    const edited = await withConnection((connection) =>
      inTransaction(connection, (tx) => editMember(tx, auth.caller.id, memberId, changes))
    );
    if (!edited.ok) {
      return edited.reason === 'clash' ? refusal(409, CREW_MESSAGES.clash) : refusal(404, CREW_MESSAGES.memberNotFound);
    }
    return NextResponse.json({ success: true, data: { member: edited.member } });
  } catch (error) {
    const message = raceMessage(error, CREW_MESSAGES.clash);
    if (message) return refusal(409, message);
    console.error('Error correcting a crew member:', error?.code || error?.name);
    return refusal(500, 'Failed to correct the cleaner');
  }
}

// Provider only. Removes the member (a soft delete: the row and its number stay, so a later add of the number brings it back) and takes them off
// every job whose crew can still change; a finished job keeps them. 200 { success: true, data: { removed: true, taken_off_jobs } }. A second
// delete is a 404.
export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const memberId = idFromPath((await params).id);
  if (memberId === null) return refusal(404, CREW_MESSAGES.memberNotFound);

  try {
    const removed = await withConnection((connection) =>
      inTransaction(connection, (tx) => removeMember(tx, auth.caller.id, memberId))
    );
    if (!removed.ok) return refusal(404, CREW_MESSAGES.memberNotFound);
    return NextResponse.json({ success: true, data: { removed: true, taken_off_jobs: removed.taken_off_jobs } });
  } catch (error) {
    const message = raceMessage(error);
    if (message) return refusal(409, message);
    console.error('Error removing a crew member:', error?.code || error?.name);
    return refusal(500, 'Failed to remove the cleaner');
  }
}
