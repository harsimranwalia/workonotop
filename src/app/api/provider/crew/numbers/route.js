// Whether each cleaner's number has been checked (ENG-015). GET /api/provider/crew answers the list ENG-014 pinned and is not touched; this route
// says, for each of the caller's cleaners who has not been removed, whether the number can be texted at all and whether its owner has proved it
// is theirs. A job link texts a code only to a number that is 'checked'. The caller's own members only: the provider is the caller and nothing in
// a request can name another.

import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { execute } from '@/lib/db';
import { listCrew } from '@/lib/booking-crew';
import { numberStates } from '@/lib/crew-number-check';

function refusal(status, message) {
  return NextResponse.json({ success: false, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Provider only. 200 { success: true, data: { numbers: [{ id, number_state }] } }: number_state is 'checked' (the number has been proved), 'unchecked'
// (not yet) or 'cannot_text' (it is not a Canadian number, which no text goes to, and a check would not help). A number that is corrected
// is 'unchecked' again; a proof is of one number.
export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  // The refusal says no-store as every answer here does. The header goes on before the check so that the check reads `if (!auth.ok) return auth.response`.
  auth.response?.headers.set('Cache-Control', 'no-store');
  if (!auth.ok) return auth.response;

  try {
    const numbers = await numberStates(execute, await listCrew(execute, auth.caller.id));
    return NextResponse.json({ success: true, data: { numbers } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error reading the number checks:', error?.code || error?.name);
    return refusal(500, 'Failed to load the number checks');
  }
}
