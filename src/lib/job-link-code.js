// src/lib/job-link-code.js
//
// How a cleaner gets into a job link (ENG-015 design, Interfaces 6; ADR-011, ADR-012). The link in the address opens nothing by itself: the cleaner
// types the mobile number the provider has for them, a six-digit code is texted to that number, and the right code buys a session for that link
// only. The two people who can be wrong here are a stranger who has the link and a stranger who guesses numbers, so nothing in the answer tells
// either of them whether a number is on the crew: a number that matches nobody, one that cannot be texted, one that was never checked and one
// that is texted all get the same reply, and the difference is only in the record of events.
//
// Everything is counted in src/lib/sms-budget.js so that a burst cannot pass a cap: asks and tries per link, one code a minute for a member on a
// link, and the daily caps every text to a number takes together. A code and a session are kept as their SHA-256 (the code's with the link, the
// member and the code in it), never as themselves, in job_link_codes: one row is the code and, once used, the session it bought, so ending the row
// ends the session. A session holds only while the link is the same generation, the member is still on the job under the same assignment and the
// number is still the one the code went to; it is judged that way on every request, so no writer of the crew needs a hook.
//
// The pool's `execute` goes in, not a transaction's: a spent count has to stay spent, and a reply must not wait on a lock. `sendText(to, message)`
// is src/lib/sms.js's sendSMS in the routes and a recorder in a spec; it answers true or false and does not throw (one that does is read as false).
// `link` is what findJobLink answers: { id, booking_id, generation, provider_id } at least. Nothing here logs a number, a name, a code or a cookie.
//
// codeText(code) -> the one text sent. ASCII, under 160 characters.
// requestCode({ execute, sendText, link, rawPhone }) -> { status: 'limited' } | { status: 'invalid', message } | { status: 'requested' }
//   In this order: the link's ask cap (every ask counts, so a flood of bad numbers is limited too); the number typed (normalisePhone, with its own
//   wording for a blank, which is addressed to a provider); the member of the job's crew who has that number and is not removed (none: an event
//   code_asked/no_match and the same reply as success); canText; the number checked by the provider (src/lib/crew-number-check.js); the minute
//   between codes for a member on a link; the daily number and provider caps; then the member's live codes on this link are retired, a code is made
//   with crypto.randomInt and stored as its hash, and the text goes. A suppressed ask is an event code_suppressed with the reason.
// verifyCode({ execute, link, rawPhone, code }) -> { status: 'limited' } | { status: 'failed' } | { status: 'signed_in', session, member }
//   The link's try cap first (every try counts); six digits and a number; the member; the live code for this link, member, generation, assignment
//   and number; the try is counted BEFORE the comparison and only while the code is live, so five wrong tries end a code however many are in
//   flight; a constant-time comparison; one UPDATE that turns the code into a session, so two right entries racing cannot both get one. Every way
//   to fail is the same `failed`. `session` is the cookie's value and `member` is { id, name }.
// sessionCookie(link, session) -> the cookie to set, in the shape response.cookies.set takes: jls_{link id}, HttpOnly, SameSite=Lax, Secure in
//   production, Path=/, and SESSION_HOURS of Max-Age. The name carries a row id and no secret.
// sessionFromRequest(request, execute, link, crew) -> { id, name, epoch } of the cleaner this request is, or null; `epoch` is the second they were
//   put on the job, which a check-in judges again inside its lock. `crew` is assignedCrew(…, { withAssignedAt: true }) of the job, read once by
//   the caller. Reads the link's own cookie with a small parser of its own, so src/lib/api-auth.js is not touched, and never reads a cookie of
//   any other name.
import { assignedCrew } from './booking-crew.js';
import { isNumberChecked } from './crew-number-check.js';
import { recordEvent } from './job-link-base.js';
import { LINK_TOKEN_PATTERN, newCode, newLinkToken, sameHash, sha256Hex } from './link-token.js';
import { canText, normalisePhone } from './phone.js';
import { budgetScope, reserve, reserveText } from './sms-budget.js';

export const CODE_DIGITS = 6;
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
export const SESSION_HOURS = 12;
export const ASKS_PER_LINK = 20;
export const VERIFIES_PER_LINK = 60;
export const CODE_COOLDOWN_SECONDS = 60;
export const COOKIE_PREFIX = 'jls_';

const HOUR_SECONDS = 60 * 60;

export const CODE_MESSAGES = {
  blank: 'Enter your mobile number.',
  limited: 'Too many requests on this link. Try again in a while.',
  failed: "That code didn't work. Check it and try again, or ask for a new one.",
  signIn: 'Enter your code to continue.',
};

export function codeText(code) {
  return `WorkOnTap: ${code} is your code to open your job. Do not share it. If you did not ask for it, ignore this text.`;
}

function codeHash(link, memberId, code) {
  return sha256Hex(`${link.id}:${memberId}:${code}`);
}

// The cleaner on the job whose number this is, or null. A removed member is never a match.
function memberWithNumber(crew, phone) {
  return crew.find((member) => !member.removed && member.phone === phone) ?? null;
}

async function suppressed(execute, link, member, detail) {
  await recordEvent(execute, link, { kind: 'code_suppressed', actor: { kind: 'visitor' }, crewMemberId: member.id, detail });
}

async function textOf(sendText, to, message) {
  try {
    return (await sendText(to, message)) === true;
  } catch {
    return false;
  }
}

export async function requestCode({ execute, sendText, link, rawPhone }) {
  if (!(await reserve(execute, budgetScope('ask', link.id), ASKS_PER_LINK, HOUR_SECONDS))) return { status: 'limited' };

  if (typeof rawPhone !== 'string' || rawPhone.trim() === '') return { status: 'invalid', message: CODE_MESSAGES.blank };
  const typed = normalisePhone(rawPhone);
  if (!typed.ok) return { status: 'invalid', message: typed.message };

  const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true });
  const member = memberWithNumber(crew, typed.phone);
  if (!member) {
    await recordEvent(execute, link, { kind: 'code_asked', actor: { kind: 'visitor' }, detail: 'no_match' });
    return { status: 'requested' };
  }

  if (!canText(member.phone)) {
    await suppressed(execute, link, member, 'cannot_text');
    return { status: 'requested' };
  }
  if (!(await isNumberChecked(execute, member))) {
    await suppressed(execute, link, member, 'not_checked');
    return { status: 'requested' };
  }
  if (!(await reserve(execute, budgetScope('cooldown', link.id, member.id), 1, CODE_COOLDOWN_SECONDS))) {
    await suppressed(execute, link, member, 'cooldown');
    return { status: 'requested' };
  }
  const capped = await reserveText(execute, member.phone, link.provider_id);
  if (capped !== null) {
    await suppressed(execute, link, member, capped);
    return { status: 'requested' };
  }

  await execute(
    'UPDATE job_link_codes SET expires_at = NOW() WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW()',
    [link.id, member.id]
  );
  const code = newCode(CODE_DIGITS);
  await execute(
    `INSERT INTO job_link_codes (link_id, generation, crew_member_id, assignment_epoch, phone, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
    [link.id, link.generation, member.id, member.assigned_epoch, member.phone, codeHash(link, member.id, code), CODE_MINUTES]
  );
  const sent = await textOf(sendText, member.phone, codeText(code));
  await recordEvent(execute, link, { kind: 'code_asked', actor: { kind: 'visitor' }, crewMemberId: member.id, detail: sent ? 'sent' : 'not_sent' });
  return { status: 'requested' };
}

export async function verifyCode({ execute, link, rawPhone, code }) {
  if (!(await reserve(execute, budgetScope('verify', link.id), VERIFIES_PER_LINK, HOUR_SECONDS))) return { status: 'limited' };

  const failed = { status: 'failed' };
  if (typeof code !== 'string' || !new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code)) return failed;
  const typed = normalisePhone(typeof rawPhone === 'string' ? rawPhone : '');
  if (!typed.ok) return failed;

  const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true });
  const member = memberWithNumber(crew, typed.phone);
  if (!member) return failed;

  const rows = await execute(
    `SELECT id, code_hash FROM job_link_codes
     WHERE link_id = ? AND crew_member_id = ? AND generation = ? AND assignment_epoch = ? AND phone = ?
       AND used_at IS NULL AND expires_at > NOW() AND attempts < ?
     ORDER BY id DESC LIMIT 1`,
    [link.id, member.id, link.generation, member.assigned_epoch, member.phone, CODE_ATTEMPTS]
  );
  if (rows.length === 0) return failed;
  const row = rows[0];

  // The try is counted before the comparison, and only while the code is still live, so the fifth wrong try is the last however many are in flight.
  const counted = await execute(
    'UPDATE job_link_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND used_at IS NULL AND expires_at > NOW()',
    [row.id, CODE_ATTEMPTS]
  );
  if (counted.affectedRows !== 1) return failed;

  if (!sameHash(codeHash(link, member.id, code), row.code_hash)) {
    await recordEvent(execute, link, { kind: 'code_failed', actor: { kind: 'visitor' }, crewMemberId: member.id });
    return failed;
  }

  const session = newLinkToken();
  const used = await execute(
    `UPDATE job_link_codes SET used_at = NOW(), session_hash = ?, session_expires_at = NOW() + INTERVAL ? HOUR
     WHERE id = ? AND used_at IS NULL AND expires_at > NOW()`,
    [sha256Hex(session), SESSION_HOURS, row.id]
  );
  if (used.affectedRows !== 1) return failed;

  await recordEvent(execute, link, { kind: 'signed_in', actor: { kind: 'cleaner', ref: member.id }, crewMemberId: member.id });
  return { status: 'signed_in', session, member: { id: member.id, name: member.name } };
}

export function sessionCookie(link, session) {
  return {
    name: `${COOKIE_PREFIX}${link.id}`,
    value: session,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * HOUR_SECONDS,
  };
}

// The value of one cookie by name, from the Cookie header; the last of several with the same name wins, as it does for request.cookies.get.
function cookieValue(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  let found = null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    let value = part.slice(at + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      found = decodeURIComponent(value);
    } catch {
      found = value;
    }
  }
  return found;
}

export async function sessionFromRequest(request, execute, link, crew) {
  const session = cookieValue(request, `${COOKIE_PREFIX}${link.id}`);
  if (session === null || !LINK_TOKEN_PATTERN.test(session)) return null;

  const rows = await execute(
    `SELECT crew_member_id, assignment_epoch, phone FROM job_link_codes
     WHERE session_hash = ? AND link_id = ? AND generation = ? AND used_at IS NOT NULL AND session_expires_at > NOW()
     LIMIT 1`,
    [sha256Hex(session), link.id, link.generation]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  const member = crew.find(
    (candidate) =>
      !candidate.removed &&
      candidate.id === row.crew_member_id &&
      candidate.assigned_epoch === Number(row.assignment_epoch) &&
      candidate.phone === row.phone
  );
  return member ? { id: member.id, name: member.name, epoch: member.assigned_epoch } : null;
}
