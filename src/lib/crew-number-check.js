// src/lib/crew-number-check.js
//
// Proof that a crew member's number is the cleaner's (ENG-015 design, Interfaces 7; ADR-012; security condition 3 carried from ENG-014). A provider
// types a number for a person and nothing shows it is theirs; a text to a wrong number is a text to a stranger. So before anything about a job is
// texted to a number, the provider asks for a check: a six-digit code goes to that number, the cleaner reads it out, and the provider types it.
// A number is CHECKED while a row with used_at set exists for the member and the member's CURRENT phone, so correcting a number in ENG-014's PATCH
// un-checks it with no hook in that route. ENG-018 texts 'checked' members only.
//
// The asking provider is signed in and owns the member, so these answers may be specific (a stranger's sign-in answers never are). Counters come
// from src/lib/sms-budget.js: one ask a minute for a member, and the daily caps every text to a number takes together. The code is kept as its
// SHA-256 with the member and the number in it, never as itself, and a try is counted before the comparison so a code cannot be guessed past its
// five. Nothing here logs a number, a code or a name.
//
// numberCheckText(code) -> the one text sent. ASCII, under 160 characters, and carrying no name: a typed name never reaches a message body.
// askNumberCheck({ execute, sendText, providerId, memberId }) -> { ok: true, sent } | { ok: false, status, message }
//   The member must be the provider's own and not removed (404 'Crew member not found'), the number must be one canText allows (409), the member
//   must not have been asked in the last minute (409), and the number and the provider must be under their daily caps (409). Then the member's
//   live codes are retired, a new one is made and stored, and `sendText(number, text)` is called (it answers true or false and never throws).
//   `sent` says whether the text went out; the code exists either way, and the budgets are spent either way.
// confirmNumberCheck({ execute, providerId, memberId, code }) -> { ok: true } | { ok: false, status, message }
//   404 for a member that is not the caller's, 400 'That code is not right.' for a wrong or malformed code, 409 for a code that has expired, been
//   used or run out of tries.
// numberStates(execute, members) -> [{ id, number_state }] in the order given, in one query. 'cannot_text' (not a number canText allows) wins over
//   'checked', which wins over 'unchecked'. `members` are crew members with id and phone.
// isNumberChecked(execute, member) -> true when a used check exists for the member and the member's current phone.
import { CREW_MESSAGES, listCrew } from './booking-crew.js';
import { newCode, sameHash, sha256Hex } from './link-token.js';
import { canText } from './phone.js';
import { budgetScope, reserve, reserveText } from './sms-budget.js';

export const CHECK_CODE_DIGITS = 6;
export const CHECK_CODE_MINUTES = 10;
export const CHECK_CODE_ATTEMPTS = 5;
export const CHECK_COOLDOWN_SECONDS = 60;

export const CHECK_MESSAGES = {
  cannotText: "We can't text this number. It is not a Canadian number.",
  wait: 'Wait a minute before asking again.',
  tooMany: 'Too many codes have been sent. Try again tomorrow.',
  wrong: 'That code is not right.',
  expired: 'That code has expired or been used up. Ask for a new one.',
};

export function numberCheckText(code) {
  return `WorkOnTap: ${code} confirms this number for a crew list. Give it to the person who added you. If you did not expect this, ignore it.`;
}

function refuse(status, message) {
  return { ok: false, status, message };
}

function codeHash(memberId, phone, code) {
  return sha256Hex(`check:${memberId}:${phone}:${code}`);
}

// The provider's own member who has not been removed, or null. Read through listCrew, the one reader of a provider's list.
async function ownMember(execute, providerId, memberId) {
  const crew = await listCrew(execute, providerId);
  return crew.find((member) => member.id === memberId) ?? null;
}

export async function askNumberCheck({ execute, sendText, providerId, memberId }) {
  const member = await ownMember(execute, providerId, memberId);
  if (!member) return refuse(404, CREW_MESSAGES.memberNotFound);
  if (!canText(member.phone)) return refuse(409, CHECK_MESSAGES.cannotText);
  if (!(await reserve(execute, budgetScope('check_ask', member.id), 1, CHECK_COOLDOWN_SECONDS))) return refuse(409, CHECK_MESSAGES.wait);
  if ((await reserveText(execute, member.phone, providerId)) !== null) return refuse(409, CHECK_MESSAGES.tooMany);

  await execute(
    'UPDATE crew_number_checks SET expires_at = NOW() WHERE crew_member_id = ? AND phone = ? AND used_at IS NULL AND expires_at > NOW()',
    [member.id, member.phone]
  );
  const code = newCode(CHECK_CODE_DIGITS);
  await execute(
    'INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE)',
    [member.id, member.phone, codeHash(member.id, member.phone, code), CHECK_CODE_MINUTES]
  );
  const sent = await sendText(member.phone, numberCheckText(code));
  return { ok: true, sent: sent === true };
}

export async function confirmNumberCheck({ execute, providerId, memberId, code }) {
  const member = await ownMember(execute, providerId, memberId);
  if (!member) return refuse(404, CREW_MESSAGES.memberNotFound);
  if (typeof code !== 'string' || !new RegExp(`^\\d{${CHECK_CODE_DIGITS}}$`).test(code)) return refuse(400, CHECK_MESSAGES.wrong);

  const rows = await execute(
    `SELECT id, code_hash FROM crew_number_checks
     WHERE crew_member_id = ? AND phone = ? AND used_at IS NULL AND expires_at > NOW() AND attempts < ?
     ORDER BY id DESC LIMIT 1`,
    [member.id, member.phone, CHECK_CODE_ATTEMPTS]
  );
  if (rows.length === 0) return refuse(409, CHECK_MESSAGES.expired);
  const row = rows[0];

  // The try is counted before the comparison, and only while the code is still live, so the fifth wrong try is the last.
  const counted = await execute(
    'UPDATE crew_number_checks SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND used_at IS NULL AND expires_at > NOW()',
    [row.id, CHECK_CODE_ATTEMPTS]
  );
  if (counted.affectedRows !== 1) return refuse(409, CHECK_MESSAGES.expired);
  if (!sameHash(codeHash(member.id, member.phone, code), row.code_hash)) return refuse(400, CHECK_MESSAGES.wrong);

  const used = await execute('UPDATE crew_number_checks SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [row.id]);
  if (used.affectedRows !== 1) return refuse(409, CHECK_MESSAGES.expired);
  return { ok: true };
}

export async function numberStates(execute, members) {
  const checked = new Set();
  if (members.length > 0) {
    const rows = await execute(
      `SELECT DISTINCT crew_member_id, phone FROM crew_number_checks
       WHERE used_at IS NOT NULL AND crew_member_id IN (${members.map(() => '?').join(', ')})`,
      members.map((member) => member.id)
    );
    for (const row of rows) checked.add(`${row.crew_member_id}:${row.phone}`);
  }
  return members.map((member) => {
    if (!canText(member.phone)) return { id: member.id, number_state: 'cannot_text' };
    return { id: member.id, number_state: checked.has(`${member.id}:${member.phone}`) ? 'checked' : 'unchecked' };
  });
}

export async function isNumberChecked(execute, member) {
  const rows = await execute(
    'SELECT 1 AS found FROM crew_number_checks WHERE crew_member_id = ? AND phone = ? AND used_at IS NOT NULL LIMIT 1',
    [member.id, member.phone]
  );
  return rows.length > 0;
}
