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
// pruneBudget(execute) -> the number of rows deleted: those whose window began more than two days ago, long past every window used here.
import { sha256Hex } from './link-token.js';

export const TEXTS_PER_NUMBER_DAY = 8;
export const TEXTS_PER_PROVIDER_DAY = 200;
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

export async function pruneBudget(execute) {
  const result = await execute('DELETE FROM sms_budget WHERE window_started_at < NOW() - INTERVAL ? DAY', [BUDGET_KEEP_DAYS]);
  return result.affectedRows;
}
