// A provider's crew list (ENG-014): GET lists the cleaners they have added, POST adds one. The provider is the caller and nothing in a request can
// name another: a provider_id in the body or the query string is not read. Each number is stored in E.164 by normalisePhone, and a number that
// is on the list already is a 409, except one on a removed entry, which brings that entry back. The names and numbers are the personal details
// of people who are not users, so they are never put in a URL and never logged.

import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { execute, withConnection } from '@/lib/db';
import { normalisePhone } from '@/lib/phone';
import { CREW_MAX, CREW_MESSAGES, addMember, inTransaction, listCrew, normaliseName, raceMessage } from '@/lib/booking-crew';

// The body of a refusal: { success, message } as the neighbouring routes answer.
function refusal(status, message) {
  return NextResponse.json({ success: false, message }, { status });
}

// Provider only. 200 { success: true, data: { crew: [{ id, name, phone }], limit } }: the caller's members who have not been removed, by name.
export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;

  try {
    const crew = await listCrew(execute, auth.caller.id);
    return NextResponse.json({ success: true, data: { crew, limit: CREW_MAX } });
  } catch (error) {
    console.error('Error listing the crew:', error?.code || error?.name);
    return refusal(500, 'Failed to load the crew');
  }
}

// Provider only. Body { name, phone }. 201 { success: true, data: { member: { id, name, phone }, revived } }. 400 names the rule that was broken;
// 409 for a number already in the crew and for a crew that already has CREW_MAX members, or for a save that lost a race to another one.
export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return refusal(400, 'Send the name and the number as a JSON body.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refusal(400, 'Send the name and the number as a JSON body.');

  const name = normaliseName(body.name);
  if (!name.ok) return refusal(400, name.message);
  const phone = normalisePhone(body.phone);
  if (!phone.ok) return refusal(400, phone.message);

  try {
    const added = await withConnection((connection) =>
      inTransaction(connection, (tx) => addMember(tx, auth.caller.id, name.name, phone.phone))
    );
    if (!added.ok) return refusal(409, CREW_MESSAGES[added.reason]);
    return NextResponse.json({ success: true, data: { member: added.member, revived: added.revived } }, { status: 201 });
  } catch (error) {
    const message = raceMessage(error, CREW_MESSAGES.duplicate);
    if (message) return refusal(409, message);
    console.error('Error adding a crew member:', error?.code || error?.name);
    return refusal(500, 'Failed to add the cleaner');
  }
}
