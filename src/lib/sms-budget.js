// src/lib/sms-budget.js
//
// Counters that hold under a burst (ENG-015 design, Interfaces 5): how many asks a link has had, how many texts a number or a provider has had,
// how soon a member may be asked again. Every other limit in the department that a burst could pass is a count read and then a write; this one is
// a single atomic step, so thirty parallel asks cannot each see "under the cap" and all go through.
//
// The table is sms_budget (database/migrations/0008-job-links.up.sql): a scope, the start of its window and the count in it. The scope is the
// SHA-256 of what is counted ('ask:12', 'number:+14035550123'), so no number, name or token is stored here. ENG-018 spends from it too, with its
// own kinds, and takes TEXTS_PER_NUMBER_DAY and TEXTS_PER_PROVIDER_DAY for every text to a number so that the daily caps cover all of them.
//
// Pass the pool's `execute` (src/lib/db.js), never a transaction's connection: a spend has to stay spent when the request that made it rolls back,
// and a connection inside a transaction would hold the row's lock until it ends.
//
// budgetScope(kind, ...parts) -> the 64-character scope for that count.
// reserve(execute, scope, cap, windowSeconds) -> true when this call is one of the first `cap` in the scope's current window and is counted, false
//   when the window is already full. Two statements on purpose. The first makes the row if there is none (window starting now, nothing used). The
//   second does the counting: it restarts the window with a count of 1 when the old one is over, or adds one when there is room, and matches no
//   row at all when the window is full, so `affectedRows === 1` says granted and 0 says capped. One statement could not say which: an upsert that
//   changes nothing reports 1, like an insert, and so cannot tell a grant from a refusal. `used` is assigned before `window_started_at` because
//   MySQL evaluates the assignments left to right and the second would otherwise see the window the first just restarted. InnoDB takes the row
//   lock in the UPDATE, so a burst is serialised there and cannot pass the cap. The pool counts matched rows (mysql2's default FOUND_ROWS flag),
//   which is what `affectedRows` is read as.
// reserveText(execute, phone, providerId, { kind }) -> null when a text to that number may go out, else 'kind_cap', 'number_cap', 'provider_cap' or
//   'platform_cap': the daily caps that every text to a number takes together, whichever code or message it carries (a sign-in code, a number-check
//   code, and every notice of ENG-018). Five scopes, narrowest first, and a text refused by one has not spent the ones after it:
//     the kind's day for one number   only for a kind in KIND_TEXTS_PER_NUMBER_DAY (quote_requested: 2). It is the one text anyone can cause for
//                                     free to a number they type, so it is taken before the number's day, or a stranger's quote forms could spend
//                                     all of a victim's eight; as it is, they can spend two
//     the kind's day for the platform only for a kind in KIND_TEXTS_PER_PLATFORM_DAY (quote_requested: 50), and refused with the same 'kind_cap'. The
//                                     per-number cap above does not bound a client who types a different number each time, and the platform's day
//                                     below is shared with every sign-in code, so without this a script of quote forms could spend the whole day
//                                     and no cleaner could be texted a sign-in code until tomorrow (ENG-018 security review, B1)
//     the number's day                TEXTS_PER_NUMBER_DAY
//     the provider's day              TEXTS_PER_PROVIDER_DAY, only when providerId is not null: a text a provider's action caused is counted against
//                                     them, and a text no provider caused (a customer's, an admin's) is not
//     the platform's day              TEXTS_PER_PLATFORM_DAY, last, so a script aimed at one capped number cannot spend the platform's count. It is a
//                                     tripwire and not a plan (ENG-015 F1): the first refusal of a day logs one 'SMS platform ceiling reached'
//   Existing callers pass three arguments and get the number's and the provider's caps and the platform's, as before plus the ceiling.
//   The scopes are made here so that no caller can spell them differently. A text refused by a later cap has already used the earlier ones, which
//   errs towards sending less.
// reserveMail(execute, address, { kind }) -> null when an e-mail of that kind may go to that address, else 'mail_cap'. An e-mail has no cost to the
//   business but it leaves from the business's own mailbox to an address a stranger chose, so a kind that a stranger can cause (quote_requested) is
//   held by two daily counts, narrowest first, and an e-mail refused by the first has not spent the second: the address's own
//   (KIND_MAILS_PER_ADDRESS_DAY, 2: one address is not mailed again and again, and the scope holds the lower-cased address as a hash, never the address)
//   and the kind's for the platform (KIND_MAILS_PER_PLATFORM_DAY, 100: the bound on a script that types a different address each time; twice the
//   texts' 50, because a quote form needs no phone). A kind in neither table is not counted and costs no query (ENG-018 security review, B1).
// pruneBudget(execute) -> the number of rows deleted: those whose window began more than two days ago, long past every window used here.
import { sha256Hex } from './link-token.js';

export const TEXTS_PER_NUMBER_DAY = 8;
export const TEXTS_PER_PROVIDER_DAY = 200;
// A tripwire and not a plan: about CAD 5 a day at carrier prices, far above what the first months of real traffic need (a job is six to ten texts).
// A day that needs more is a day devops hears of from the warn line, and raises this constant.
export const TEXTS_PER_PLATFORM_DAY = 500;
export const KIND_TEXTS_PER_NUMBER_DAY = Object.freeze({ quote_requested: 2 });
// A tenth of the platform's day at most: the one text a stranger can cause for free is never allowed more than that, however many numbers it is typed with.
export const KIND_TEXTS_PER_PLATFORM_DAY = Object.freeze({ quote_requested: 50 });
export const KIND_MAILS_PER_ADDRESS_DAY = Object.freeze({ quote_requested: 2 });
export const KIND_MAILS_PER_PLATFORM_DAY = Object.freeze({ quote_requested: 100 });
export const DAY_SECONDS = 24 * 60 * 60;
export const BUDGET_KEEP_DAYS = 2;

export function budgetScope(kind, ...parts) {
  return sha256Hex([kind, ...parts].join(':'));
}

export async function reserve(execute, scope, cap, windowSeconds) {
  await execute(
    'INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW(), 0) ON DUPLICATE KEY UPDATE scope = scope',
    [scope]
  );
  const result = await execute(
    `UPDATE sms_budget
     SET used = IF(window_started_at <= NOW() - INTERVAL ? SECOND, 1, used + 1),
         window_started_at = IF(window_started_at <= NOW() - INTERVAL ? SECOND, NOW(), window_started_at)
     WHERE scope = ? AND (window_started_at <= NOW() - INTERVAL ? SECOND OR used < ?)`,
    [windowSeconds, windowSeconds, scope, windowSeconds, cap]
  );
  return result.affectedRows === 1;
}

// The first 'platform_cap' of a UTC day says so once. The cap-1 counter says whether this refusal is the first; if counting it fails the line is
// still written, because one line too many is better than a ceiling nobody was told about.
async function warnPlatformCeiling(execute) {
  let first = true;
  try {
    first = await reserve(execute, budgetScope('platform-warned', new Date().toISOString().slice(0, 10)), 1, DAY_SECONDS);
  } catch (e) {
    console.warn(`SMS platform ceiling check failed: ${e?.code || e?.name || 'unknown'}`);
  }
  if (first) console.warn('SMS platform ceiling reached');
}

export async function reserveText(execute, phone, providerId, { kind = null } = {}) {
  const kindCap = kind === null ? undefined : KIND_TEXTS_PER_NUMBER_DAY[kind];
  if (kindCap !== undefined && !(await reserve(execute, budgetScope('kind', kind, phone), kindCap, DAY_SECONDS))) return 'kind_cap';
  const kindPlatformCap = kind === null ? undefined : KIND_TEXTS_PER_PLATFORM_DAY[kind];
  if (kindPlatformCap !== undefined && !(await reserve(execute, budgetScope('kind-platform', kind), kindPlatformCap, DAY_SECONDS))) return 'kind_cap';
  if (!(await reserve(execute, budgetScope('number', phone), TEXTS_PER_NUMBER_DAY, DAY_SECONDS))) return 'number_cap';
  if (providerId !== null && providerId !== undefined) {
    if (!(await reserve(execute, budgetScope('provider', providerId), TEXTS_PER_PROVIDER_DAY, DAY_SECONDS))) return 'provider_cap';
  }
  if (!(await reserve(execute, budgetScope('platform', 'day'), TEXTS_PER_PLATFORM_DAY, DAY_SECONDS))) {
    await warnPlatformCeiling(execute);
    return 'platform_cap';
  }
  return null;
}

export async function reserveMail(execute, address, { kind = null } = {}) {
  const addressCap = kind === null ? undefined : KIND_MAILS_PER_ADDRESS_DAY[kind];
  if (addressCap !== undefined && !(await reserve(execute, budgetScope('mail', kind, address.toLowerCase()), addressCap, DAY_SECONDS))) return 'mail_cap';
  const platformCap = kind === null ? undefined : KIND_MAILS_PER_PLATFORM_DAY[kind];
  if (platformCap !== undefined && !(await reserve(execute, budgetScope('mail-kind', kind), platformCap, DAY_SECONDS))) return 'mail_cap';
  return null;
}

export async function pruneBudget(execute) {
  const result = await execute('DELETE FROM sms_budget WHERE window_started_at < NOW() - INTERVAL ? DAY', [BUDGET_KEEP_DAYS]);
  return result.affectedRows;
}
