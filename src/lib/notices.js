// src/lib/notices.js
//
// The one path every text and e-mail about an event takes (ENG-018, ADR-018). A route does not call a transport for an event: it asks the event's
// function in notice-events.js, which decides who is told and calls sendNotice here once for each person. This is the only module that names
// sendSMSResult and sendEmail for an event, so the rules below cannot be walked around by a route that forgot them.
//
// sendNotice(execute, request, deps) -> { sms, email }: for each channel, an outcome (NOTICE_OUTCOMES), 'duplicate' (this notice was already
//   claimed, so nothing was done) or null (the channel was not asked for). It never throws: whatever goes wrong is an outcome and one fixed line,
//   'Notice error: {code}', carrying no number, address, name, body or link.
//   request  { kind, subject, bookingId, to, channels, values, path, spendFor }
//     kind       one of NOTICE_KINDS. It names the template and, for a text, the per-number cap of that kind (KIND_TEXTS_PER_NUMBER_DAY)
//     subject    the ids that make this event this event: [bookingId], [bookingId, providerId], [linkId, generation, memberId, assignedEpoch]. With the
//                kind, the recipient and the channel they are the send-once key (noticeKey), so a repeat of the event sends nothing more
//     bookingId  the booking the record points at; null for a quote request
//     to         { kind: 'customer' | 'provider' | 'cleaner' | 'admin', ref, phone, email, checked, active }. ref is a users.id,
//                service_providers.id or provider_crew_members.id, or null for a customer with no account. `checked` is whether a cleaner's number
//                has passed its check and `active` whether a provider's status is 'active': the caller reads both from the row, because this module
//                reaches for no table but its own
//     channels   ['sms'], ['email'] or both: what is asked for. Asking for an e-mail the kind has no words for is an error and not a skip
//     values     what the template needs (notice-templates.js); a `url` in it is ignored, the only link is the one made from `path`
//     path       '/card/{token}', '/job/{token}', '/provider/jobs': joined to appOrigin() here, so no caller spells an origin
//     spendFor   the provider whose action caused a text, against whose day it counts (reserveText); null for any other
//   For each channel, SMS first, and the two do not depend on each other (a text that is refused leaves the e-mail to go):
//     1. a refusal that needs no table, each written as a row with no key so that the same notice can be made again when the cause is cured:
//        no_contact, bad_contact, cannot_text, unchecked (a cleaner's number is not checked), not_active (a provider whose status is not 'active'
//        is told nothing, by text or by e-mail), then no_origin (the kind cannot do without its link and there is no usable origin)
//     2. the claim: the row is INSERTed with its key and 'pending' BEFORE anything is sent, and ER_DUP_ENTRY means someone else holds this notice.
//        That is what makes two requests at once, a retry and a second route reaching the same place send once. A process that dies after the
//        claim leaves a 'pending' row and the key, and the notice is not made again, because it may have gone (PENDING_STALE_MINUTES is how long
//        a reader waits before calling such a row lost)
//     3. a text spends from the budget (reserveText: the kind's day for the number and for the platform, the number's, the provider's and the
//        platform's day), and an e-mail of a kind a stranger can cause spends from its own (reserveMail: the address's day and the platform's, for
//        that kind only); a cap sets the key to NULL and the outcome to the cap ('mail_cap' for an e-mail), so the notice can be made again tomorrow
//     4. the transport, whose answer is mapped to sent, not_configured, rejected or unsure; a throw is 'error'
//     5. the row is settled. Only 'not_configured' lets go of the key (nothing was attempted, and a credential may be set); everything else that
//        reached the transport keeps it, so a timeout or a carrier error is never answered with a second text.
//   deps     { sendSMS, sendMail, appOrigin } for a spec that records instead of sending. They default to sendSMSResult, sendEmail and appOrigin.
//            sendMail is called with { to, subject, text } and nothing else: an e-mail here is plain text.
//   Pass the pool's `execute` (src/lib/db.js), never a transaction's connection: the notice runs after the commit and its record must outlive any
//   rollback of the request that caused it.
//
// noticeKey({ kind, subject, recipientKind, recipientRef, channel }) -> the 64-character key. A spec uses it to find the row it expects. The row
//   holds ids and codes and no number, address, name, body or link.
// appOrigin(env) -> the origin a link is made on, or null. NEXT_PUBLIC_APP_URL without its trailing slash; outside production 'http://localhost:3000'
//   when it is not set; in production anything but an https: origin is null, and so is a value with a path, a query, a fragment or credentials.
// afterCommit(work) -> runs `work` once the response has gone (Next's after()) and falls back to a detached promise where there is no request to
//   attach it to (a script, a spec). It never throws and a failing `work` is one 'Notice error: {code}' line. Call it after the COMMIT, never inside
//   a transaction.
// pruneNotices(execute) -> the number of rows deleted: those older than NOTICE_KEEP_DAYS. src/lib/crew-retention.js runs it with its sweep.
import { sendSMSResult } from './sms.js';
import { sendEmail } from './email.js';
import { normalisePhone, canText } from './phone.js';
import { reserveMail, reserveText } from './sms-budget.js';
import { sha256Hex } from './link-token.js';
import { templateFor } from './notice-templates.js';

export const NOTICE_KEEP_DAYS = 180;
export const PENDING_STALE_MINUTES = 10;
export const NOTICE_OUTCOMES = Object.freeze([
  'pending', 'sent', 'not_configured', 'rejected', 'unsure', 'bad_contact', 'cannot_text', 'no_contact', 'unchecked', 'not_active',
  'number_cap', 'kind_cap', 'provider_cap', 'platform_cap', 'mail_cap', 'no_origin', 'error',
]);

const RECIPIENT_KINDS = Object.freeze(['customer', 'provider', 'cleaner', 'admin']);
const CHANNELS = Object.freeze(['sms', 'email']);
// A notice whose whole point is its link. With no usable origin there is nothing to send, so it is refused as no_origin; any other kind carries a
// link only as a convenience in an e-mail and goes without it.
const LINK_REQUIRED = new Set(['card_link', 'job_link']);
const KEY_PART = /^[A-Za-z0-9_-]{1,64}$/;
// One address and nothing else: no list (a comma or semicolon), no display name (angle brackets, quotes, brackets), no line break or other control.
const MAILBOX = /^[^\s@,;<>()"\\\u0000-\u001F\u007F]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const MAILBOX_MAX = 254;
const MAIL_NOT_CONFIGURED = 'Email configuration missing';

const codeOf = (error) => error?.code || error?.name || 'unknown';
const fail = (code) => Object.assign(new Error(code), { code });
const isId = (value) => Number.isSafeInteger(value) && value > 0;
const isIdOrNone = (value) => value === null || value === undefined || isId(value);

// Next's after() keeps work alive once the response has gone. Plain Node (a spec, a script) cannot import next/server, and the work then runs detached.
const nextAfter = await import('next/server').then((module) => module.after ?? null, () => null);

export function noticeKey({ kind, subject, recipientKind, recipientRef = null, channel } = {}) {
  const parts = Array.isArray(subject) ? subject : [];
  const isPart = (part) => (Number.isSafeInteger(part) && part >= 0) || (typeof part === 'string' && KEY_PART.test(part));
  if (typeof kind !== 'string' || !KEY_PART.test(kind) || parts.length === 0 || !parts.every(isPart)
    || !RECIPIENT_KINDS.includes(recipientKind) || !isIdOrNone(recipientRef) || !CHANNELS.includes(channel)) {
    throw fail('bad_notice_key');
  }
  return sha256Hex([kind, ...parts, recipientKind, recipientRef ?? 0, channel].join(':'));
}

export function appOrigin(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const configured = String(env.NEXT_PUBLIC_APP_URL ?? '').trim();
  if (configured === '') return production ? null : 'http://localhost:3000';
  let url;
  try {
    url = new URL(configured);
  } catch {
    // A value that is not a URL is no origin; the notice that needed one says so as no_origin.
    return null;
  }
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && !production);
  const bare = url.username === '' && url.password === '' && url.search === '' && url.hash === '' && url.pathname.replace(/\/+$/, '') === '';
  return allowed && bare ? url.origin : null;
}

// True when Next took `run` to keep alive after the response. Outside a request (a script, a spec) after() throws and nothing was scheduled: false.
function scheduledAfterResponse(run) {
  try {
    nextAfter(run);
    return true;
  } catch {
    return false;
  }
}

export function afterCommit(work) {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      console.error(`Notice error: ${codeOf(error)}`);
    }
  };
  // Where nothing was scheduled the work runs here instead. Its own failures are logged by `run`.
  if (nextAfter !== null && scheduledAfterResponse(run)) return;
  void run();
}

export async function pruneNotices(execute) {
  const result = await execute('DELETE FROM notice_attempts WHERE created_at < NOW() - INTERVAL ? DAY', [NOTICE_KEEP_DAYS]);
  return result.affectedRows;
}

// Who can be reached on a channel, by what needs no table. { why } is the refusal, in the design's order, or null; { address } is where it goes.
function smsTarget(to) {
  if (typeof to.phone !== 'string' || to.phone.trim() === '') return { why: 'no_contact' };
  const phone = normalisePhone(to.phone);
  if (!phone.ok) return { why: 'bad_contact' };
  if (!canText(phone.phone)) return { why: 'cannot_text' };
  if (to.kind === 'cleaner' && to.checked !== true) return { why: 'unchecked' };
  if (to.kind === 'provider' && to.active !== true) return { why: 'not_active' };
  return { why: null, address: phone.phone };
}

function mailTarget(to) {
  if (typeof to.email !== 'string' || to.email.trim() === '') return { why: 'no_contact' };
  const address = to.email.trim();
  if (address.length > MAILBOX_MAX || !MAILBOX.test(address)) return { why: 'bad_contact' };
  if (to.kind === 'provider' && to.active !== true) return { why: 'not_active' };
  return { why: null, address };
}

function planOf(request) {
  const to = request?.to;
  const channels = Array.isArray(request?.channels) ? [...new Set(request.channels)] : [];
  if (to === null || typeof to !== 'object' || !RECIPIENT_KINDS.includes(to.kind) || !isIdOrNone(to.ref) || !isIdOrNone(request.bookingId)
    || !isIdOrNone(request.spendFor) || channels.length === 0 || !channels.every((channel) => CHANNELS.includes(channel))) {
    throw fail('bad_notice_request');
  }
  const keys = Object.fromEntries(channels.map((channel) => [
    channel, noticeKey({ kind: request.kind, subject: request.subject, recipientKind: to.kind, recipientRef: to.ref ?? null, channel }),
  ]));
  return { channels, keys };
}

// The words, or the reason there are none: 'no_origin' when the kind needs its link and there is no origin, 'error' when the template refused.
function wordsFor(request, origin) {
  const wantsLink = typeof request.path === 'string';
  if (wantsLink && origin === null && LINK_REQUIRED.has(request.kind)) return { why: 'no_origin' };
  try {
    return { why: null, made: templateFor(request.kind, { ...request.values, url: wantsLink && origin !== null ? `${origin}${request.path}` : undefined }) };
  } catch (error) {
    console.error(`Notice error: ${codeOf(error)}`);
    return { why: 'error' };
  }
}

const smsOutcome = (answer) => {
  if (answer?.ok === true) return 'sent';
  switch (answer?.reason) {
    case 'not_configured': case 'rejected': case 'unsure': return answer.reason;
    case 'bad_number': return 'bad_contact';
    case 'destination_not_allowed': return 'cannot_text';
    default: return 'error';
  }
};

// SMTP cannot say whether a message left, so a failure that is not the missing configuration is 'unsure' and keeps the key.
const mailOutcome = (answer) => {
  if (answer?.success === true) return 'sent';
  if (answer?.success !== false) return 'error';
  return answer.error === MAIL_NOT_CONFIGURED ? 'not_configured' : 'unsure';
};

// A refusal is a row of its own with no key, already settled.
async function refuse(execute, request, channel, why) {
  await execute(
    `INSERT INTO notice_attempts (event_key, kind, channel, recipient_kind, recipient_ref, booking_id, outcome, settled_at)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, NOW())`,
    [request.kind, channel, request.to.kind, request.to.ref ?? null, request.bookingId ?? null, why]
  );
  return why;
}

async function settle(execute, id, outcome, { release = false } = {}) {
  await execute(`UPDATE notice_attempts SET outcome = ?, settled_at = NOW()${release ? ', event_key = NULL' : ''} WHERE id = ?`, [outcome, id]);
}

async function deliver(execute, request, plan, channel, address, made, send) {
  let id;
  try {
    const claimed = await execute(
      `INSERT INTO notice_attempts (event_key, kind, channel, recipient_kind, recipient_ref, booking_id, outcome)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [plan.keys[channel], request.kind, channel, request.to.kind, request.to.ref ?? null, request.bookingId ?? null]
    );
    id = claimed.insertId;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return 'duplicate';
    throw error;
  }

  if (channel === 'sms') {
    const capped = await reserveText(execute, address, request.spendFor ?? null, { kind: request.kind });
    if (capped !== null) {
      await settle(execute, id, capped, { release: true });
      return capped;
    }
  } else {
    const capped = await reserveMail(execute, address, { kind: request.kind });
    if (capped !== null) {
      await settle(execute, id, capped, { release: true });
      return capped;
    }
  }

  let outcome;
  try {
    outcome = channel === 'sms'
      ? smsOutcome(await send.sms(address, made.sms))
      : mailOutcome(await send.mail({ to: address, subject: made.subject, text: made.text }));
  } catch (error) {
    console.error(`Notice error: ${codeOf(error)}`);
    outcome = 'error';
  }
  await settle(execute, id, outcome, { release: outcome === 'not_configured' });
  return outcome;
}

async function reach(execute, request, plan, channel, words, send) {
  const target = channel === 'sms' ? smsTarget(request.to) : mailTarget(request.to);
  if (target.why !== null) return refuse(execute, request, channel, target.why);
  if (words.why !== null) return refuse(execute, request, channel, words.why);
  if (channel === 'email' && words.made.text === null) {
    console.error('Notice error: no_email_template');
    return refuse(execute, request, channel, 'error');
  }
  return deliver(execute, request, plan, channel, target.address, words.made, send);
}

export async function sendNotice(execute, request, deps = {}) {
  const answer = { sms: null, email: null };
  try {
    const plan = planOf(request);
    const send = { sms: deps.sendSMS ?? sendSMSResult, mail: deps.sendMail ?? sendEmail };
    const words = wordsFor(request, (deps.appOrigin ?? appOrigin)());
    for (const channel of plan.channels) {
      try {
        answer[channel] = await reach(execute, request, plan, channel, words, send);
      } catch (error) {
        console.error(`Notice error: ${codeOf(error)}`);
        answer[channel] = 'error';
      }
    }
  } catch (error) {
    // A request that does not make sense has no recipient or key to write a row for, and nothing was sent.
    console.error(`Notice error: ${codeOf(error)}`);
  }
  return answer;
}
