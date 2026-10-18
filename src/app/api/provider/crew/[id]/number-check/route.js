// Proving a cleaner's number is theirs (ENG-015). The provider asks for a code to be texted to the number on the crew list, the cleaner reads it
// out, and the provider types it in: a number that has been proved is one a job link may text a sign-in code to, so a mistyped number or a number
// that belongs to someone else never receives one. Only the caller's own active members can be reached: one that is another provider's, one that
// was removed, one that does not exist and an id that is not a number are all the same 404. The number and the code are never put in a URL or a
// log line.

import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { execute } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { CREW_MESSAGES, idFromPath, raceMessage } from '@/lib/booking-crew';
import { askNumberCheck, confirmNumberCheck } from '@/lib/crew-number-check';
import { afterCommit } from '@/lib/notices';
import { noticeJobLinksOfMember } from '@/lib/notice-events';

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function refusal(status, message) {
  return reply({ success: false, message }, status);
}

// Provider only. Body { action: 'ask' } or { action: 'confirm', code }. ask texts a six-digit code to the member's number and answers 200
// { success: true, data: { asked: true, sent } }; sent is false when the text could not be sent (no texting service is set up, or the service
// refused), and the code is made either way. 403 when the provider's account is not active (an ask spends the platform's day of texts, so it is
// refused before anything is spent). 409 says why a code was not made: the number is not Canadian, a code was asked for in the last minute,
// or too many were sent today. confirm answers 200 { success: true, data: { checked: true } }; 400 for a wrong code; 409 for a code that has
// expired, been used up or was never asked for. 404 for a member that is not the caller's active one.
export async function POST(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  // The refusal says no-store as every answer here does. The header goes on before the check so that the check reads `if (!auth.ok) return auth.response`.
  auth.response?.headers.set('Cache-Control', 'no-store');
  if (!auth.ok) return auth.response;
  const memberId = idFromPath((await params).id);
  if (memberId === null) return refusal(404, CREW_MESSAGES.memberNotFound);

  let body;
  try {
    body = await request.json();
  } catch {
    return refusal(400, 'Invalid request.');
  }
  if (body?.action !== 'ask' && body?.action !== 'confirm') return refusal(400, 'Invalid request.');

  try {
    if (body.action === 'ask') {
      const asked = await askNumberCheck({ execute, sendText: sendSMS, providerId: auth.caller.id, memberId });
      if (!asked.ok) return refusal(asked.status, asked.message);
      return reply({ success: true, data: { asked: true, sent: asked.sent } });
    }
    const confirmed = await confirmNumberCheck({ execute, providerId: auth.caller.id, memberId, code: body.code });
    if (!confirmed.ok) return refusal(confirmed.status, confirmed.message);
    // The cleaner whose number has just been proved is texted the link of each open job they are on that has one on (ENG-018), once this answer has gone: a
    // number that was unchecked when the link was made was refused then, and this is the first moment it can be reached.
    afterCommit(() => noticeJobLinksOfMember(execute, { memberId }));
    return reply({ success: true, data: { checked: true } });
  } catch (error) {
    const message = raceMessage(error);
    if (message) return refusal(409, message);
    console.error('Error checking a crew number:', error?.code || error?.name);
    return refusal(500, 'Failed to check the number');
  }
}
