// The route matrix: every route file and exported method under src/app/api, one row each, as data (207 rows).
//
// SOURCE: Appendix A of agents/architect/designs/ENG-004-lock-down-unauthenticated-access-and-role-checks.md (the
// design for ENG-004; ADR-003). This file was generated from that table, in the table's order and with its route
// strings verbatim, and QA reviews the two against each other, so do not reorder or rename a row. When a route is
// added, removed or reclassified, change the appendix's row and this row together.
//
// AC5 DOES NOT HOLD WHILE ONE `pending` ROW REMAINS. GET /api/bookings/[id]/invoice/download is `pending`: the
// approver answered the G2 on 2026-10-02 04:09 with "Option 3" (build the rest first, decide this later), so the
// route stays as it is, neither locked nor declared public, and the ENG-004 container does not ship until a fresh
// G2 is answered and the row becomes `roles` or `public`. The coverage test prints that row on every run and the
// role-by-route test annotates and skips it; nothing passes it silently.
//
// Three tests read this file: e2e/auth-coverage.spec.js (coverage and wiring) and e2e/auth-matrix.spec.js
// (role by route). The shape of a row:
//   route    Appendix A "Route", verbatim, with [param] segments. The file is src/app/api<route>/route.js.
//   method   GET | POST | PUT | PATCH | DELETE
//   today    Appendix A "Today": none | partial | full (the census grade of the check on the code at 9763c05)
//   kind     'roles' | 'public' | 'self' | 'pending'
//   roles    kind 'roles' only: a non-empty subset of admin | customer | provider (Appendix A "Target")
//   public   kind 'public' only: the text after "PUBLIC:" in the appendix
//   self     kind 'self' only: the text after "SELF:" (the route's own secret)
//   pending  kind 'pending' only: why it is pending
//   owner    Appendix A "Owner", verbatim ('-' means the role alone decides; otherwise the ownership rule that the
//            converting ticket builds into the handler, from `caller`, never from the request)
//   note     the census note as in the appendix (cut to fit there), plus a line where this file adds something
//   probe    what the role-by-route test sends:
//              path      the route with each [param] replaced by PROBE_IDS.missing, an id no fixture row has
//              body      undefined for GET and DELETE (104 rows) and for the four POST and PUT rows whose handler `await`s
//                        request.json() before its first side effect (a request with no body throws there, nothing is
//                        written; the notes of the four cite the lines); {} for the other 99 POST, PUT and PATCH rows. {} is
//                        the convention, not a finding that the handler validates it: see "What a probe does" below.
//              query     optional, e.g. '?id=999999999', for a handler that reads its id from the query (none set yet)
//              anon      roles rows: 401, always (the contract). public and self rows: an array of the statuses a
//                        request with no credential may get. public: what today's handler answers, measured on the
//                        dev app. self: the design's refusal status (cron 401; AI gateway 401, or 500 when the key
//                        is unset; Stripe 400, or 500 when the secret is unset) widened only by what the dev app
//                        answers because that secret is not configured there (the note says which).
//              allowed   optional: statuses acceptable for a role the row allows when the handler's own validation
//                        legitimately answers 401 or 403 (default: anything but 401 or 403)
//              hold      optional, '<reason>': the case sends NOTHING, from any credential, and fails with the reason on its
//                        first line. For a row where one request from any caller does real work. A known failure until the
//                        converting ticket adds the guard and removes the hold.
//              holdAllowed  optional, '<reason>', roles rows only: the case does not send the styles whose role the row
//                        allows (the answers annotation prints `held`); it still sends none and every wrong role and asserts
//                        none = 401 and each wrong role = exactly 403. For a row where an allowed caller's request does real
//                        work whatever it carries.
//
// The one mixed target, PUT /api/provider ("admin (`?id=` branches), provider (no-`id` branch)"), is
// roles: ['admin', 'provider'] with the split in its note.
//
// What a probe does. Every probe uses a fixture account only (@workontap.test), an id no fixture row has, and an empty body
// or none: 207 of the 207 rows, by a script (the body is undefined or {}, the path is the route with each [param] replaced
// by PROBE_IDS.missing, no row sets a query). That does not make a probe harmless by itself: a handler that needs no input
// acts on {} and on nothing (ENG-020 review B1, QA F1). What the notes say about it, as counted by script:
//   - Twelve rows carry a `Probe (B2, 2026-10-02` line (the rows whose note holds that text): GET and PATCH
//     /api/admin/deletion-requests, POST /api/bookings/[id]/restart, GET /api/cron/auto-release, GET /api/cron/notifications,
//     GET and PUT /api/customers/[id], POST and PUT /api/provider/availability, and POST /api/provider/onboarding/complete,
//     /create-stripe-account and /stripe-complete. Eleven of them say, with handler line numbers, what stops the probe (a
//     missing body that throws at `await request.json()`, a validation, an ownership check, a foreign key, or the data) and,
//     where the handler writes or sends, the first side effect it stops before (a write, a schema change, mail, a push, an
//     outbound call, a payment, a file); GET /api/admin/deletion-requests carries only a cross-reference to the PATCH row, for
//     the same fetch.
//   - The other 195 rows have no such line: 116 are write rows (POST, PUT, PATCH, DELETE) and 79 are GET (script counts).
//     50 of the 195 (36 public, 13 self, 1 pending) carry a `Probe measured on the dev app` line instead, which records the
//     status measured there for the request with no credential and no body. Code-review round 1 read the write handlers the
//     probes reach (88: 31 admin, 57 other; agents/principal-engineer/notebook/2026-10-02-eng020-review.md; the matrix has
//     93 routes with a write row, 31 admin and 62 other, and the difference was not traced). It did not read the GET
//     handlers, nor the public, self and pending rows as such. The GET handlers were scanned in review round 2 (comments
//     removed; the scan found two that reach a write) and again by this round's sweep of all 83 GET rows (next bullet). No
//     field of those 195 rows other than `note` differs from commit 1aed079 (script compare, 195 of 195). A row without a
//     `Probe (` line is not a finding that its probe is harmless.
//   - This round's sweep of the 83 GET rows: comments removed, the method's text and the same-file helpers and `@/` library
//     functions it calls followed (22 helpers, 14 library functions), searched for INSERT, UPDATE, DELETE, ALTER TABLE,
//     CREATE TABLE, a mail, push or SMS send, a Stripe call, an outbound fetch or axios, a file write and a cookie set. Five
//     rows matched and the other 78 did not: GET /api/admin/deletion-requests (the fetch at deletion-requests/route.js:22-24;
//     its note refers to the PATCH row), both cron rows (held), GET /api/provider/onboarding/stripe-return and GET
//     /api/provider/verify-email. The GET work of this round added a `Probe (round 3, 2026-10-02` line to three rows: those
//     last two and GET /api/cron/notifications, whose second job (:62-111) its first note did not name. Of the 200 SQL call
//     sites those GET handlers reach, 153 start with a literal SELECT, WITH or SHOW, 34 pass a variable that is declared from
//     a literal SELECT or WITH, and 13 are in the five rows named. A text search, not a run: a side effect behind a name or
//     a module these patterns do not know would not show.
//   - This round's sweep of the write rows (QA's static scan: 28 rows with no note, 21 with no body read before the first
//     side effect and 7 that read it and reach a write with no 4xx between; the readers' data is in
//     agents/eng-manager/notebook/eng020-scripts/sweep-C1.json and sweep-C2.json). Each was read in its handler, comments
//     removed, to its first side effect. 11 are stopped before it by what the request has to carry (a required `?id=` or
//     `?url=` query value in 10, the body's `all` or `id` in PUT /api/admin/notifications); 15 are keyed on the path id and the
//     probe's id matches no row (the class named below; DELETE /api/user/addresses/[id] is also stopped today by a table the
//     dev database does not have); 2 are stopped by the database driver refusing undefined binds, which is not a
//     validation: PATCH /api/admin/invoices (by that alone) and PUT /api/admin/providers (by that and by the missing `action`),
//     and each carries a `Probe (round 3, 2026-10-02` line.
//     27 more admin and customers PUT, POST and PATCH rows were read the same way and one more write the probe reaches turned up,
//     POST /api/admin/logout (an `activity_logs` row, which every run writes anyway); it carries a line too. A reading, not a run.
//   - The whole suite's run is MEASURED, not argued: `CHECKSUM TABLE` over the 33 tables before and after, and counts over the
//     app log of the run's own window of the lines matching `Admin notification sent`, `Email sent|sendEmail|Message
//     sent|nodemailer`, `SMTP`, `Stripe account created|Reusing existing Stripe account` and `ALTER TABLE`. The runs recorded
//     in the ENG-020 ticket log (build round 2's two windows and QA round 2's full run) differ in `activity_logs` and
//     `mobile_auth_users` and in no other table, with 0 lines matching each of those patterns. QA's full run also has 6 lines
//     `Email sending failed but database updated`, which match none of them: they are the catch of PUT /api/admin/providers
//     after the driver refused the undefined `providerId`, before any send. That is what those greps can show; a Stripe call
//     that logs none of those lines would not appear in them.
//   - One class is not a per-row fact and has no note: an id-keyed write whose probe id (PROBE_IDS.missing, 999999999)
//     matches no row. It is harmless while no row has that id, which depends on the fixtures and on nothing in the row.
// Where one request from a caller the row allows (or from any caller) does real work, the row is held, with its reason in
// `probe.hold` or `probe.holdAllowed`. The held rows are:
//   hold         none now (ENG-022 put requireCronSecret in both cron routes and removed their holds: with CRON_SECRET unset, as it
//                is on the dev app and must stay, every request from any credential, `Bearer undefined` and `?secret=undefined`
//                included, is 401 before the job runs, so the case sends all seven styles and expects 401 from each)
//   holdAllowed  POST /api/provider/onboarding/complete                   (keep the hold until the converting ticket proves the
//                                                                         allowed path another way: a fixture provider the
//                                                                         handler may rewrite, or a stub of the mail send)
// Remove a hold in the same change that converts its handler, not before. No imports, so plain Node and Playwright read
// this file the same way.

export const PROBE_IDS = { missing: 999999999 };

export const matrix = [
    {
        route: '/api/admin/blogs', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/blogs/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: No auth; returns every blog row including drafts (is_published ignored).',
        probe: { path: '/api/admin/blogs', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/blogs', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/blogs/route.js:18-19), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Anyone can publish posts; public src/app/blogs/[id]/page.js:205 renders content via dangerously…',
        probe: { path: '/api/admin/blogs', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/blogs/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/blogs/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: No auth; any blog, including unpublished, readable by sequential id.',
        probe: { path: '/api/admin/blogs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/blogs/[id]', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/blogs/[id]/route.js:24-25), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Anyone can overwrite any post; content is rendered raw on the public page (blogs/[id]/page.js:2…',
        probe: { path: '/api/admin/blogs/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/blogs/[id]', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/blogs/[id]/route.js:53-54), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Anyone can hard-delete any blog by sequential id.',
        probe: { path: '/api/admin/blogs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/bookings/[id]/override', method: 'PUT', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/bookings/[id]/override/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Role trusted from JWT claim, no DB re-check; worker_count and actual_duration_minutes unvalidat…',
        probe: { path: '/api/admin/bookings/999999999/override', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/cities', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/cities/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: verifyAdmin is a signature check only: any customer, provider, mobile or email-verification JWT…',
        probe: { path: '/api/admin/cities', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/cities', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/cities/route.js:83-84), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check: any signed-up customer or provider can create cities. Cookie only, no Beare…',
        probe: { path: '/api/admin/cities', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/cities/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/cities/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check as the cities list; low-sensitivity reference data.',
        probe: { path: '/api/admin/cities/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/cities/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/cities/[id]/route.js:30-31), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check: any logged-in user can rename or deactivate a city.',
        probe: { path: '/api/admin/cities/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/cities/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/cities/[id]/route.js:54-55), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check: any logged-in user can delete a city; dependent rows are not handled here.',
        probe: { path: '/api/admin/cities/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/deletion-requests', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/deletion-requests/route.js:6-7), before the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard: auth was an HTTP self-call that depended on NEXT_PUBLIC_APP_URL being right (/me read only the adminAuth cookie). That self-call (route.js:22-24 at 1d67c30) is gone: the guard reads the cookie or the Bearer in the process. Probe (B2, 2026-10-02): not held. The probe\'s Cookie header no longer leaves the process for this route (see the PATCH row).',
        probe: { path: '/api/admin/deletion-requests', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/deletion-requests', method: 'PATCH', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PATCH calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/deletion-requests/route.js:42-43), before the body is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard: status is free text with no allow-list; only marks the request and emails the requester, no dat… Probe (B2, 2026-10-02): not held. The fetch of NEXT_PUBLIC_APP_URL /api/admin/me that sent the probe Cookie header to that host before any check (route.js:63-65 at 1d67c30) is gone, so a stack that sets NEXT_PUBLIC_APP_URL to another host no longer needs to hold this row. With the admin cookie the handler stops at the 400 at :47-49 (id and status are required), before any query or mail; every other credential is stopped by the guard at :42-43.',
        probe: { path: '/api/admin/deletion-requests', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/disputes', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/disputes/route.js:10-11), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: No auth: every dispute with customer/provider emails and Stripe payment_intent_id exposed. A co…',
        probe: { path: '/api/admin/disputes', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/disputes', method: 'PATCH', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PATCH calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/disputes/route.js:75-76), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Undeclared action/capture_amount/provider_amount (:110,:117) throw, so it returns 500 today; on…',
        probe: { path: '/api/admin/disputes', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/disputes/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/disputes/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: No auth: any dispute by sequential id with customer/provider emails, Stripe account id and paym…',
        probe: { path: '/api/admin/disputes/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/districts', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/districts/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check as cities: any customer, provider or mobile token in the adminAuth cookie pa…',
        probe: { path: '/api/admin/districts', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/districts', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/districts/route.js:76-77), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check: any signed-up customer or provider can create districts.',
        probe: { path: '/api/admin/districts', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/districts/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/districts/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check; low-sensitivity reference data.',
        probe: { path: '/api/admin/districts/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/districts/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/districts/[id]/route.js:29-30), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check: any logged-in user can rename or deactivate a district.',
        probe: { path: '/api/admin/districts/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/districts/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/districts/[id]/route.js:53-54), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Same any-JWT check: any logged-in user can delete a district; dependent rows are not handled he…',
        probe: { path: '/api/admin/districts/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/earnings', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: platform revenue, commission and payout totals plus every invoice row were exposed (now to an admin only). A cooki… ENG-021 guard: src/app/api/admin/earnings/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/earnings', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth; with no filter it returns every invoice row and any invoice is readable by id or booking_id (now for an admin only). ENG-021 guard: src/app/api/admin/invoices/route.js:7-8 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/invoices', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices', method: 'PATCH', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth; arbitrary status string, no allow-list or existence check: anyone could flip any invoice (now an admin only)… Probe (round 3, 2026-10-02): UPDATE invoices at src/app/api/admin/invoices/route.js:58-61, with invoice_id and status read from the body at :55 and no validation. The probe sends {} so both binds are undefined and mysql2 execute (src/lib/db.js:51) refuses them: stopped only by the driver refusing undefined binds, not by a validation (with NULL binds, WHERE id = NULL would still match no row). A body that supplies both fields reaches a real UPDATE: validate them before :58, or hold the row, first. ENG-021 guard: invoices/route.js:52-53 (requireCaller(request, [\'admin\']), ahead of the body read at :55); only the admin style gets past it and then behaves as the probe line above describes, the other styles are refused there. The line numbers in that probe line are the ones after this change.',
        probe: { path: '/api/admin/invoices', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/invoices/[id]/preview', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: customer PII was served by sequential invoice id (now to an admin only); booking fields go unescaped into the HTML (stor… ENG-021 guard: src/app/api/admin/invoices/[id]/preview/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/invoices/999999999/preview', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices/[id]/preview/download', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth, so anyone could do this and now only an admin can: each request launches headless Chrome (DoS) on HTML with unescaped customer-supplied f… ENG-021 guard: src/app/api/admin/invoices/[id]/preview/download/route.js:31-32 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/invoices/999999999/preview/download', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices/generate', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: anyone could create or overwrite customer and provider invoice amounts for any booking (now an admin only); … ENG-021 guard: src/app/api/admin/invoices/generate/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/invoices/generate', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/login', method: 'POST', today: 'none', kind: 'public', public: 'admin login (credential exchange)', owner: '-',
        note: 'No rate limit or lockout seen (brute force); unknown email returns before bcrypt (timing oracle… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and password are required\'.',
        probe: { path: '/api/admin/login', body: {}, anon: [400] },
    },
    {
        route: '/api/admin/logout', method: 'POST', today: 'none', kind: 'public', public: 'logout, clears own cookie', owner: '-',
        note: 'Stateless JWT is not revoked: a stolen adminAuth token stays valid up to 24h after logout. Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 200. Probe (round 3, 2026-10-02): logActivity at src/app/api/admin/logout/route.js:12-19 inserts an ADMIN_LOGGED_OUT row into activity_logs when the adminAuth cookie verifies (:10-11), so the admin-cookie style writes one row per run; the response only puts two cookie deletes on it (:32-33). Nothing stops it: the row is public and no body is read. It is the known activity_logs delta, and no other state changes.',
        probe: { path: '/api/admin/logout', body: {}, anon: [200] },
    },
    {
        route: '/api/admin/logs', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: the whole audit trail was readable by anyone (now by an admin only); limit is uncapped; limit/offset are parseInt-ed bef… ENG-021 guard: src/app/api/admin/logs/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/logs', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/me', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/me/route.js:49-50), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Strongest check in this set (DB-backed role) but keyed on payload.id only; token role/type igno…',
        probe: { path: '/api/admin/me', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/notifications', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: 'notifications where user_id=token id and user_type=\'admin\'',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/notifications/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Only route in this set accepting both Bearer and cookie. Role comes from the JWT claim, no DB r…',
        probe: { path: '/api/admin/notifications', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/notifications', method: 'PUT', today: 'full', kind: 'roles', roles: ['admin'], owner: 'notifications of the token\'s admin',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/notifications/route.js:26-27), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Ownership enforced in the WHERE clause, so a body id cannot touch another admin\'s rows; role fr…',
        probe: { path: '/api/admin/notifications', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/payouts', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: provider balances, emails and Stripe payout/transfer ids were exposed (now to an admin only). A cookie-only fix wo… ENG-021 guard: src/app/api/admin/payouts/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. GET() took no parameter before ENG-021; it is GET(request) at :5 now.',
        probe: { path: '/api/admin/payouts', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/provider-jobs', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth, so anyone got this and now only an admin does: the response includes the whole provider row (password hash, reset_token, email_verificati… ENG-021 guard: src/app/api/admin/provider-jobs/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/provider-jobs', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Until ENG-021 the handler read a token (the adminAuth or provider_token cookie, or a Bearer) and ignored it; that dead read is deleted. sp.* returns, to an admin only now, every provider\'s password hash, live reset_token and email_… ENG-021 guard: src/app/api/admin/providers/route.js:166-167 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/providers', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 anyone could approve or reject any provider (now an admin only); rejectionReason goes unescaped into an email sent fr… Probe (round 3, 2026-10-02): UPDATE service_providers in src/app/api/admin/providers/route.js:246 and :260 and sendEmail at :288 and :295 need action approve or reject; the probe sends none. The SELECT at :270 binds an undefined providerId and the driver refuses it, so logActivity (:276) is not reached: stopped by the missing action and the driver refusing undefined binds, not by a validation. Validate both before :243, or hold the row, first. ENG-021 guard: providers/route.js:235-236 (requireCaller(request, [\'admin\']), ahead of the body read at :238); only the admin style gets past it and then behaves as the probe line above describes. The cookie/Bearer token read the handler had was never used and is deleted; the line numbers in the probe line are the ones after this change.',
        probe: { path: '/api/admin/providers', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: anyone could rewrite any provider\'s email then use forgot-password: account takeover (the PUT is admin only now). \'E… ENG-021 guard: src/app/api/admin/providers/[providerId]/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/providers/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth, so anyone could trigger (now only an admin can) the irreversible cascade hard-delete of a provider and all their bookings, invoices, chat … ENG-021 guard: src/app/api/admin/providers/[providerId]/route.js:35-36 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/providers/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]/documents', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth: provider contact data and all KYC document records were readable for any provider id (now by an admin only); error.message … ENG-021 guard: src/app/api/admin/providers/[providerId]/documents/route.js:9-10 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/providers/999999999/documents', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]/documents', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Before ENG-021 there was no auth, so anyone could use this and now only an admin can: approve_all marks every KYC document verified (verification bypass); reject_all resets… ENG-021 guard: src/app/api/admin/providers/[providerId]/documents/route.js:45-46 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/admin/providers/999999999/documents', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/providers/approve', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/providers/approve/route.js:135-136), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: No auth: approve also forces email_verified=1 and clears the verification token; suspend/reacti…',
        probe: { path: '/api/admin/providers/approve', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/seo', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/seo/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: UNAUTHENTICATED despite /api/admin path (middleware guards /admin pages only, not /api); return…',
        probe: { path: '/api/admin/seo', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/seo', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/seo/route.js:26-27), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: UNAUTHENTICATED write; header_scripts is rendered as a live script in head by app/layout.js:87 …',
        probe: { path: '/api/admin/seo', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/seo/[id]', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/seo/[id]/route.js:53-54), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: UNAUTHENTICATED delete of any SEO row by sequential id.',
        probe: { path: '/api/admin/seo/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/seo/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/seo/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: UNAUTHENTICATED read of any SEO row incl. header_scripts and footer_scripts.',
        probe: { path: '/api/admin/seo/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/seo/[id]', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/seo/[id]/route.js:24-25), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: UNAUTHENTICATED overwrite of any SEO row incl. header_scripts/footer_scripts, rendered live by …',
        probe: { path: '/api/admin/seo/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-areas', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-areas/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer and provider tokens share JWT_SECRET), e.g. a self-regi…',
        probe: { path: '/api/admin/service-areas', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-areas', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-areas/route.js:36-37), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (same verifyAdmin as GET); creates cluster rows.',
        probe: { path: '/api/admin/service-areas', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-areas', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-areas/route.js:70-71), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes; record id comes from the query string (L74); body fields not val…',
        probe: { path: '/api/admin/service-areas', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-areas/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-areas/[id]/route.js:50-51), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/service-areas/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-areas/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-areas/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes; also a bug: const [rows] on execute() result (L10), so a hit ret…',
        probe: { path: '/api/admin/service-areas/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-areas/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-areas/[id]/route.js:24-25), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/service-areas/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-locations', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-locations/route.js:10-11), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes; 500 body echoes error.message (L127).',
        probe: { path: '/api/admin/service-locations', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-locations', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-locations/route.js:135-136), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any valid JWT passes and is audit-logged as actor_type admin (L218-220; the actor is auth.caller.email now); description HTML rende…',
        probe: { path: '/api/admin/service-locations', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-locations/[id]/route.js:207-208), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any valid JWT passes; deletes public landing-page rows; id parsed from URL (L211).',
        probe: { path: '/api/admin/service-locations/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-locations/[id]/route.js:10-11), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any valid JWT passes; 500 body echoes error.message (L35).',
        probe: { path: '/api/admin/service-locations/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'PATCH', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PATCH calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-locations/[id]/route.js:167-168), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any valid JWT passes; toggles is_active, hiding or showing public location pages. Probe (round 3, 2026-10-02): the probe sends PROBE_IDS.missing (999999999) and {}, so the UPDATE at src/app/api/admin/service-locations/[id]/route.js:180 matches no row; the handler then inserts an activity_logs row (:182-189), which every run writes anyway (see the measure in the header above).',
        probe: { path: '/api/admin/service-locations/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/service-locations/[id]/route.js:43-44), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any valid JWT passes; can rewrite slug, canonical and raw-HTML description (rendered unsanitize…',
        probe: { path: '/api/admin/service-locations/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/settings', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/settings/route.js:7-8), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Only DB-backed admin check in this chunk; looks id up in users only, so a mobile/Google provide…',
        probe: { path: '/api/admin/settings', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/settings', method: 'POST', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/settings/route.js:24-25), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Writes any key/value incl. default_commission (provider commission rate); logs key and value (L…',
        probe: { path: '/api/admin/settings', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/skills', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/skills/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/skills', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/skills/route.js:47-48), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/skills/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/skills/[id]/route.js:54-55), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/skills/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/skills/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/skills/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/skills/[id]/route.js:24-25), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/states', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/states/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/states', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/states/route.js:53-54), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/states/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/states/[id]/route.js:48-49), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/states/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/states/[id]/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/states/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/states/[id]/route.js:24-25), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/testimonials', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/testimonials/route.js:7-8), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes; refusal body uses key error, not message.',
        probe: { path: '/api/admin/testimonials', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/testimonials', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/testimonials/route.js:22-23), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes; testimonial text is public site content.',
        probe: { path: '/api/admin/testimonials', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/testimonials/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/testimonials/[id]/route.js:26-27), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/testimonials/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/testimonials/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/admin/testimonials/[id]/route.js:7-8), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/testimonials/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/ai-gateway/openapi.json', method: 'GET', today: 'none', kind: 'public', public: 'API description for the AI agent import, no data', owner: '-',
        note: 'Spec only, no secrets; documents the gateway write surface and names AI_GATEWAY_SECRET_KEY (L59… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/ai-gateway/openapi.json', body: undefined, anon: [200] },
    },
    {
        route: '/api/ai-gateway/v1/seo', method: 'DELETE', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Can delete any SEO row incl. global; key compare is non-constant-time (ai-gateway-auth L33); no… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and no body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/seo', body: undefined, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/seo', method: 'GET', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'One static shared secret for read, write and delete; non-constant-time compare (ai-gateway-auth… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and no body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/seo', body: undefined, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/seo', method: 'PATCH', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Delegates to POST so the check applies; undefined fields keep existing values (seoService L90-9… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/seo', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/seo', method: 'POST', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Key holder can write header_scripts/footer_scripts, rendered live in head by layout.js:87: scri… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/seo', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/service-locations', method: 'DELETE', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Deletes public landing-page rows; no audit log or soft delete; shared key. Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and no body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/service-locations', body: undefined, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/service-locations', method: 'GET', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Read-only; filters are parameterized; 500 bodies echo error.message. Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and no body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/service-locations', body: undefined, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/service-locations', method: 'PATCH', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Delegates to POST so the check applies. Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/service-locations', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/service-locations', method: 'POST', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Writes raw HTML description rendered unsanitized on public pages (ServiceLocationClientPage.jsx… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/service-locations', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/service-locations/sync-canonicals', method: 'POST', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Bulk rewrite of every canonical_url, one UPDATE per row, no confirmation or rate limit; shared … Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/service-locations/sync-canonicals', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/services', method: 'GET', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Read-only; returns full services rows incl. inactive unless active_only; 500 bodies echo error.… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/services', body: undefined, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/services', method: 'PATCH', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Delegates to POST so the check applies. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/services', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/ai-gateway/v1/services', method: 'POST', today: 'full', kind: 'self', self: 'AI gateway key (unchanged)', owner: '-',
        note: 'Key holder can change live service prices and visibility; no audit log; no delete method. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 500 \'Server configuration error: AI_GATEWAY_SECRET_KEY is not set.\'. The key is not configured on the dev app, so the route already fails closed with 500; a configured app answers 401, so both are accepted.',
        probe: { path: '/api/ai-gateway/v1/services', body: {}, anon: [401, 500] },
    },
    {
        route: '/api/auth/apple', method: 'POST', today: 'full', kind: 'public', public: 'social sign-in (Apple id token verified)', owner: '-',
        note: 'ADMIN BYPASS L79-85: verified email matching an admin user gets a role:admin JWT, no password; … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Apple identity token is required\'.',
        probe: { path: '/api/auth/apple', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/change-password', method: 'POST', today: 'full', kind: 'roles', roles: ['customer', 'provider'], owner: 'own account (table by role)',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/auth/change-password/route.js:7-8, requireCaller(request, [customer, provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own account (table by role)) comes from auth.caller, never from a request field; caller.id bound at src/app/api/auth/change-password/route.js:32, :52. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Looks up users first by token id, ignoring token role: a provider token with id N hits users.id…',
        probe: { path: '/api/auth/change-password', body: {}, anon: 401 },
    },
    {
        route: '/api/auth/data-deletion', method: 'POST', today: 'full', kind: 'public', public: 'deletion request, password re-verified in the body', owner: '-',
        note: 'Pre-password branches answer 404 unknown email (L29-34), 403 admin account (L37-42), 400 alread… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and password are required\'.',
        probe: { path: '/api/auth/data-deletion', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/forgot-password', method: 'POST', today: 'none', kind: 'public', public: 'reset request; abuse guard is the emailed OTP/link', owner: '-',
        note: '6-digit Math.random OTP for source=mobile (L267), logged (L269); reset-password L28 accepts it … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email is required\'.',
        probe: { path: '/api/auth/forgot-password', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/google', method: 'POST', today: 'full', kind: 'public', public: 'social sign-in (Google id token verified)', owner: '-',
        note: 'ADMIN BYPASS L71-77: email matching an admin user gets a role:admin JWT, no password; email_ver… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Google token is required\'.',
        probe: { path: '/api/auth/google', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/login', method: 'POST', today: 'full', kind: 'public', public: 'customer login', owner: '-',
        note: 'No rate limit or lockout; provider-email message (L33-36) is an account-type oracle; response r… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and password are required\'.',
        probe: { path: '/api/auth/login', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/logout', method: 'POST', today: 'none', kind: 'public', public: 'logout, clears own cookie', owner: '-',
        note: 'Clears only customer_token (provider_token and adminAuth untouched); no server-side revocation,… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 200.',
        probe: { path: '/api/auth/logout', body: {}, anon: [200] },
    },
    {
        route: '/api/auth/me', method: 'GET', today: 'full', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'own profile (table by role)',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/auth/me/route.js:12-13, requireCaller(request, [customer, provider, admin]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own profile (table by role)) comes from auth.caller, never from a request field; caller.id bound at src/app/api/auth/me/route.js:18. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Reset/verification JWTs (type claim, providerId) accepted and fall to users lookup by providerI…',
        probe: { path: '/api/auth/me', body: undefined, anon: 401 },
    },
    {
        route: '/api/auth/mobile/forgot-password', method: 'POST', today: 'none', kind: 'public', public: 'reset request; abuse guard is the emailed OTP', owner: '-',
        note: 'MEDIUM: 404 at line 30 enumerates accounts; 6-digit Math.random OTP (34) stored plaintext and w… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email is required\'.',
        probe: { path: '/api/auth/mobile/forgot-password', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/mobile/google', method: 'POST', today: 'partial', kind: 'public', public: 'social sign-in', owner: '-',
        note: 'MEDIUM: audience check skipped when no Google client-id env is set (45-54); email_verified not … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Google token is required\'.',
        probe: { path: '/api/auth/mobile/google', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/mobile/login', method: 'POST', today: 'full', kind: 'public', public: 'mobile login', owner: '-',
        note: 'LOW: no rate limit; role-mismatch 403s precede the password check (enumeration); admin gets adm… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email, password, and role are required\'.',
        probe: { path: '/api/auth/mobile/login', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/mobile/logout', method: 'POST', today: 'full', kind: 'public', public: 'logout by refresh-token possession', owner: '-',
        note: 'LOW: capability in body, not a Bearer check; unknown token returns 200 success; the 7d access J… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Refresh token is required\'.',
        probe: { path: '/api/auth/mobile/logout', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/mobile/refresh', method: 'POST', today: 'full', kind: 'public', public: 'refresh by refresh-token possession', owner: '-',
        note: 'LOW: rotation mints a fresh 7d JWT; pending_deletion/deleted status is not checked (58-63); JWT… ENG-024: the role of the token it mints comes from the account row the session points to (src/app/api/auth/mobile/refresh/route.js:38-48), and e2e/mobile-refresh-role.spec.js shows it. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Refresh token is required\'.',
        probe: { path: '/api/auth/mobile/refresh', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/reset-password', method: 'POST', today: 'partial', kind: 'public', public: 'reset completion; guard is the OTP/token (see S1)', owner: '-',
        note: 'ENG-022 S1 (2026-10-03, 7a86bc2): before the query the handler refuses with 400 { success: false, message: \'Valid token or Email/OTP required\' } any token, email or otp that is present and is not a string (src/app/api/auth/reset-password/route.js:18-22). On this route the raw token, email and otp go to query(), which formats a non-string value into the SQL text instead of binding it (src/lib/db.js:63-68), so an object, an array, a number or a boolean can no longer reach the SQL; a string is handled as before. The exploitability probe of the unfixed code did NOT run (see 7a86bc2), so the finding below is from code reading and was not exercised; the cases that pin the 400 are in e2e/s1-reset-otp.spec.js. Census finding, line numbers moved to this file: HIGH, from code reading, not run: query() is client-side escaping (db.js:68) and body otp/token… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'New password is required\'.',
        probe: { path: '/api/auth/reset-password', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/signup', method: 'POST', today: 'none', kind: 'public', public: 'customer signup', owner: '-',
        note: 'LOW: session cookie issued with no email verification (247); body values go to client-side-esca… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Password must be at least 8 characters and contain both alphabets and \'.',
        probe: { path: '/api/auth/signup', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/verify-otp', method: 'POST', today: 'partial', kind: 'public', public: 'OTP check (see S1)', owner: '-',
        note: 'ENG-022 S1 (2026-10-03, 7a86bc2): before the query the handler refuses with 400 { success: false, message: \'Email and OTP are required\' } an email or otp that is not a string (a missing one gets the 400 it always got) (src/app/api/auth/verify-otp/route.js:12-16). No non-string request value ever reached query() in this route: a non-string email threw at .trim() (route.js:18), before the query, so it was a 500, and otp is stringified by .toString() (route.js:19) and bound as a string. The check turns that 500 into a 400 and stops a JSON-number otp being coerced into a string that could match a stored code; a string is handled as before. The exploitability probe of the unfixed code did NOT run (see 7a86bc2), so the finding below is from code reading and was not exercised; the cases that pin the 400 are in e2e/s1-reset-otp.spec.js. Census finding, line numbers moved to this file: MEDIUM: boolean oracle for the 6-digit reset OTP with no attempt limit; OTP not consumed; NULL … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and OTP are required\'.',
        probe: { path: '/api/auth/verify-otp', body: {}, anon: [400] },
    },
    {
        route: '/api/bookings', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL before ENG-021 (an admin only now): anonymous delete of any booking plus its invoices, provider_payouts, reviews and chat… ENG-021 guard: src/app/api/bookings/route.js:524-525 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/bookings', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH before ENG-021 (an admin only now, ?email= included): anonymous dump of every booking (name, email, phone, address, lat/long, payment_intent_id… ENG-021 guard: src/app/api/bookings/route.js:23-24 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/bookings', method: 'POST', today: 'partial', kind: 'public', public: 'guest checkout; a credential, if sent, sets the owner (R1)', owner: '-',
        note: 'HIGH: payment_intent_id only checked truthy (120), never verified with Stripe (client declared … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Missing required fields (Service, Date, Time, Address, or Email)\'.',
        probe: { path: '/api/bookings', body: {}, anon: [400] },
    },
    {
        route: '/api/bookings', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL before ENG-021 (an admin only now): an anonymous caller could set any booking\'s status, provider, payment_status and commissio… ENG-021 guard: src/app/api/bookings/route.js:340-341 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. The activity log\'s actor is the verified admin (auth.caller.id, :352-353), not a decoded Bearer.',
        probe: { path: '/api/bookings', body: {}, anon: 401 },
    },
    {
        route: '/api/bookings/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH before ENG-021 (an admin only now): anonymous read of any booking by sequential id or guessable booking_number (BK + timestam… ENG-021 guard: src/app/api/bookings/[id]/route.js:7-8 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. Callers: the app\'s admin job screen (mobile/src/screens/admin/AdminJobDetailsScreen.js:35, Bearer) and the web admin page (src/app/admin/bookings/[id]/page.js:34, cookie); the website\'s receipt page (src/app/booking/success/[id]/page.js) no longer calls it (design ENG-004 Amendment 6).',
        probe: { path: '/api/bookings/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/bookings/[id]/invoice/download', method: 'GET', today: 'none', kind: 'pending', pending: 'G2, the invoice-download one-way door: the approver answered option 3 on 2026-10-02 04:09 (\'build the rest first, decide this later\'), so this route stays exactly as it is today (no check) and is neither locked nor declared public until the fresh G2 is answered (the design recommends customer, admin). A browser tab cannot carry the app\'s token, so any check here breaks the app\'s two Download Invoice buttons.', owner: 'booking.user_id = caller',
        note: 'HIGH: anonymous PDF of any booking by sequential id; a plain Bearer check would break the mobil… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 404 \'Booking not found\'. The route has no check today; this status is informational and is not asserted.',
        probe: { path: '/api/bookings/999999999/invoice/download', body: undefined, anon: [404] },
    },
    {
        route: '/api/bookings/[id]/reassign', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH before ENG-021 (an admin only now): anonymous reassign and reset of any booking, completed or disputed included; old_provider… ENG-021 guard: src/app/api/bookings/[id]/reassign/route.js:6-7 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/bookings/999999999/reassign', body: {}, anon: 401 },
    },
    {
        route: '/api/bookings/[id]/restart', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH before ENG-021 (an admin only now): anonymous removal of the provider and reset to pending on any booking; no status guard, s… Probe (B2, 2026-10-02): not held, probe unchanged. The handler never reads the body. The UPDATE at restart/route.js:22-34 matches no row for 999999999, and the INSERT into booking_status_history at :37-41 is stopped only by the database: SHOW CREATE TABLE on the dev DB (structure only, 07:01 on 2026-10-02) shows booking_status_history_ibfk_1, booking_id REFERENCES bookings (id) ON DELETE CASCADE, so the INSERT fails, the transaction rolls back (:45-48) and the catch answers 500. A schema without that foreign key would store a history row for a booking that does not exist. ENG-021 guard: restart/route.js:6-7 (requireCaller(request, [\'admin\'])), ahead of the UPDATE; it does not read the body either, so the probe (admin style only now) still stops where it did. The line numbers in the probe line above are the ones after this change.',
        probe: { path: '/api/bookings/999999999/restart', body: {}, anon: 401 },
    },
    {
        route: '/api/categories', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/categories/route.js:117-118), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: HIGH: anonymous delete of any category by id; audit log is forged as Admin id 1 (134-141); effe…',
        probe: { path: '/api/categories', body: undefined, anon: 401 },
    },
    {
        route: '/api/categories', method: 'GET', today: 'none', kind: 'public', public: 'public catalogue', owner: '-',
        note: 'INFO: public by design; SELECT * returns every column of active rows (12), including any admin-… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/categories', body: undefined, anon: [200] },
    },
    {
        route: '/api/categories', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/categories/route.js:31-32), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: HIGH: anonymous category creation; audit log forged as Admin id 1 (50-58); icon and image_url s…',
        probe: { path: '/api/categories', body: {}, anon: 401 },
    },
    {
        route: '/api/categories', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/categories/route.js:76-77), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: HIGH: anonymous update or deactivation of any category (is_active from body); audit log forged …',
        probe: { path: '/api/categories', body: {}, anon: 401 },
    },
    {
        route: '/api/chat', method: 'GET', today: 'none', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/chat/route.js:21-22, requireCaller(request, [customer, provider, admin]): no credential is 401 and a wrong role 403 before the body is read). Ownership (participant of the booking (user_id or provider_id); admin all) comes from auth.caller, never from a request field; 403 refusals src/app/api/chat/route.js:43. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): HIGH: anonymous read of any booking\'s full chat history by sequential bookingId, with sender id…',
        probe: { path: '/api/chat', body: undefined, anon: 401 },
    },
    {
        route: '/api/chat', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/chat/route.js:91-92, requireCaller(request, [customer, provider, admin]): no credential is 401 and a wrong role 403 before the body is read). Ownership (participant of the booking (user_id or provider_id); admin all) comes from auth.caller, never from a request field; 403 refusals src/app/api/chat/route.js:127. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): MEDIUM: any logged-in user can post into any booking\'s chat and trigger an email and push with …',
        probe: { path: '/api/chat', body: {}, anon: 401 },
    },
    {
        route: '/api/chat/mark-read', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/chat/mark-read/route.js:16-17, requireCaller(request, [customer, provider, admin]): no credential is 401 and a wrong role 403 before the body is read). Ownership (participant of the booking (user_id or provider_id); admin all) comes from auth.caller, never from a request field; 403 refusals src/app/api/chat/mark-read/route.js:30, :35. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): LOW: token only verified, never used; any logged-in user can mark any booking\'s messages read; …',
        probe: { path: '/api/chat/mark-read', body: {}, anon: 401 },
    },
    {
        route: '/api/chat/unread', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/chat/unread/route.js:16-17, requireCaller(request, [customer, provider, admin]): no credential is 401 and a wrong role 403 before the body is read). Ownership (participant of the booking (user_id or provider_id); admin all) comes from auth.caller, never from a request field; 403 refusals src/app/api/chat/unread/route.js:35, :36, :42. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): LOW: returns only a count, but any logged-in user can probe any booking; client userType picks …',
        probe: { path: '/api/chat/unread', body: undefined, anon: 401 },
    },
    {
        route: '/api/cron/auto-release', method: 'GET', today: 'partial', kind: 'self', self: 'CRON_SECRET, made fail-closed', owner: '-',
        note: 'ENG-022: requireCronSecret(request) is the first statement of GET (src/app/api/cron/auto-release/route.js:10-11). With CRON_SECRET unset, as on the dev app (it must stay unset there), every request is 401, `Bearer undefined` and `?secret=undefined` included; with it set, the secret is accepted as `Authorization: Bearer` or `?secret=` and anything else is 401. The acceptance of \'Bearer undefined\' and the development-mode skip (route.js:13-16 at 1d67c30) are gone. Census finding before the guard: MEDIUM: if CRON_SECRET is unset the header \'Bearer undefined\' matches (15 at 1d67c30); development mode by… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body, before the change: 200, the job ran for an anonymous caller. Probe (B2, 2026-10-02): hold, removed by ENG-022 on 2026-10-03: the row is not held now; it sends all seven credential styles and expects 401 from each (anon [401]). The job\'s first side effect sits behind the guard: it selects the bookings awaiting approval for 24 hours (:14-24) and for each captures a Stripe payment (:37), creates a transfer (:47) and updates the booking (:60-63). Today it moves nothing only because the dev DB has no such booking (0 with a payment intent at 07:04 on 2026-10-02): harmless by data, not by construction (before the change it ran for any caller in development mode and stopped only for want of data; now every request is 401 before the SELECT).',
        probe: { path: '/api/cron/auto-release', body: undefined, anon: [401] },
    },
    {
        route: '/api/cron/notifications', method: 'GET', today: 'partial', kind: 'self', self: 'CRON_SECRET, made fail-closed', owner: '-',
        note: 'ENG-022: requireCronSecret(request) is the first statement of GET (src/app/api/cron/notifications/route.js:10-11). With CRON_SECRET unset, as on the dev app (it must stay unset there), every request is 401, `Bearer undefined` and `?secret=undefined` included; with it set, the secret is accepted as `Authorization: Bearer` or `?secret=` and anything else is 401. The check that was skipped when CRON_SECRET was unset or empty (route.js:14 at 1d67c30) is gone. Census finding before the guard: MEDIUM: fail-open, no check at all when CRON_SECRET is unset or empty (14 at 1d67c30); anonymous caller ca… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body, before the change: 500 \'Internal Server Error\' (the route did not refuse the anonymous caller). Probe (B2, 2026-10-02): hold, removed by ENG-022 on 2026-10-03: the row is not held now; it sends all seven credential styles and expects 401 from each (anon [401]). The first job sits behind the guard: it selects the providers with stripe_onboarding_complete = 0 (:21-26) and for each sends an email (:41) and a push (:47) and updates onboarding_reminder_stage (:49-52). Today it stops only because that column is not in the dev schema (absent at 07:04 on 2026-10-02), so the SELECT throws and the answer is 500: an accident, not a guard before the change; now every request is 401 before the SELECT. Probe (round 3, 2026-10-02): the handler holds a second job in the same try (:57-106) that runs when the server hour is 19 or later (:61-64): it selects the confirmed bookings of tomorrow not yet reminded (:67-75) and for each emails and pushes the customer (:82-89) and, when a provider is assigned, the provider (:92-100), then updates bookings (:103). It is not reached today: the first SELECT throws first (:21-26, to the catch at :110-113), and if it were reached it would select nothing: it takes only confirmed bookings of tomorrow (:67-75) and both fixture bookings are completed, with job date 2026-01-15 (database/fixtures hold six files, whose sets insert into users, service_providers, service_categories, services, system_settings, bookings, invoices, provider_payouts and provider_reviews).',
        probe: { path: '/api/cron/notifications', body: undefined, anon: [401] },
    },
    {
        route: '/api/customer/booking-details', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller (today enforced, role not)',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/customer/booking-details/route.js:137-138, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (bookings.user_id = caller (today enforced, role not)) comes from auth.caller, never from a request field; 403 refusals src/app/api/customer/booking-details/route.js:178. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): LOW: ownership enforced, role is not; a provider or admin JWT whose id equals a customer\'s user… The website\'s receipt page (src/app/booking/success/[id]/page.js) reads it too since ENG-021, for a signed-in customer whose tab holds no saved booking (design ENG-004 Amendment 6).',
        probe: { path: '/api/customer/booking-details', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/bookings', method: 'GET', today: 'none', kind: 'roles', roles: ['customer', 'admin'], owner: 'bookings.user_id = caller; a `?user_id=`/`?email=` naming anyone else: 403',
        note: 'HIGH before ENG-021: anyone could read any customer\'s bookings by sequential ?user_id= or by ?email=: b.* incl. add… ENG-021 guard: src/app/api/customer/bookings/route.js:18-19 calls requireCaller(request, [\'customer\', \'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. A customer is the caller (no parameter lists their own bookings) and a ?user_id= or ?email= naming anyone else is 403 (namesAnotherAccount at :8-12, checked at :28); an admin may name anyone, as before.',
        probe: { path: '/api/customer/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/bookings', method: 'POST', today: 'none', kind: 'roles', roles: ['customer', 'admin'], owner: 'booking_id must belong to caller (`AND b.user_id = caller`)',
        note: 'HIGH before ENG-021: the verification was a user_id or email the caller supplied; sequential booking_id plus gu… ENG-021 guard: src/app/api/customer/bookings/route.js:120-121 calls requireCaller(request, [\'customer\', \'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. A customer naming another account in the body is 403 (:135); for a customer the SQL adds AND b.user_id = caller.id (:159-162); a booking that exists but is not theirs is 403 (:180-183) and one that does not exist keeps the 404; an admin still selects by the body user_id or email.',
        probe: { path: '/api/customer/bookings', body: {}, anon: 401 },
    },
    {
        route: '/api/customer/bookings/[id]/approve', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller (today enforced, role not)',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/customer/bookings/[id]/approve/route.js:155-156, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (bookings.user_id = caller (today enforced, role not)) comes from auth.caller, never from a request field; 403 refusals src/app/api/customer/bookings/[id]/approve/route.js:195. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): MEDIUM: moves money; role unchecked, a provider JWT whose id equals the customer\'s users.id pas…',
        probe: { path: '/api/customer/bookings/999999999/approve', body: {}, anon: 401 },
    },
    {
        route: '/api/customer/bookings/[id]/cancel', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller (today enforced, role not)',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/customer/bookings/[id]/cancel/route.js:7-8, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (bookings.user_id = caller (today enforced, role not)) comes from auth.caller, never from a request field; 403 refusals src/app/api/customer/bookings/[id]/cancel/route.js:27. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): LOW: ownership enforced, role is not; a provider JWT whose id collides with a customer\'s users.…',
        probe: { path: '/api/customer/bookings/999999999/cancel', body: {}, anon: 401 },
    },
    {
        route: '/api/customer/invoices', method: 'GET', today: 'none', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller; a `?user_id=`/`?email=` naming anyone else: 403',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/customer/invoices/route.js:6-7, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (bookings.user_id = caller; a `?user_id=`/`?email=` naming anyone else: 403) comes from auth.caller, never from a request field; 403 refusals src/app/api/customer/invoices/route.js:19, :22. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): HIGH: ?user_id=null passes the guard (10) but adds no WHERE filter (28-34), returning every cus…',
        probe: { path: '/api/customer/invoices', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/reviews', method: 'GET', today: 'none', kind: 'roles', roles: ['customer'], owner: 'own booking; customer_id from caller',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/customer/reviews/route.js:145-146, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own booking; customer_id from caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/customer/reviews/route.js:161, :167. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): LOW: with sequential booking_id and customer_id anyone reads review text, rating and invoice st…',
        probe: { path: '/api/customer/reviews', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/reviews', method: 'POST', today: 'none', kind: 'roles', roles: ['customer'], owner: 'own booking; customer_id from caller',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/customer/reviews/route.js:11-12, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own booking; customer_id from caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/customer/reviews/route.js:34, :43, :44. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): HIGH: anonymous review on any paid booking, attributed to any customer_id and counted against A…',
        probe: { path: '/api/customer/reviews', body: {}, anon: 401 },
    },
    {
        route: '/api/customers', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/customers/route.js:155-156), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: CRITICAL: anonymous delete of any users row (admins included) and all their bookings by user_id…',
        probe: { path: '/api/customers', body: undefined, anon: 401 },
    },
    {
        route: '/api/customers', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/customers/route.js:7-8), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: CRITICAL: with no param it returns EVERY user incl. admin accounts (email, phone, role); ?email…',
        probe: { path: '/api/customers', body: undefined, anon: 401 },
    },
    {
        route: '/api/customers', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/customers/route.js:54-55), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: CRITICAL: anonymous caller can create a users row with role \'admin\' (91), then log in through /…',
        probe: { path: '/api/customers', body: {}, anon: 401 },
    },
    {
        route: '/api/customers', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/customers/route.js:103-104), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: CRITICAL: anonymous password reset of ANY account (customer, provider or admin) by numeric id: …',
        probe: { path: '/api/customers', body: {}, anon: 401 },
    },
    {
        route: '/api/customers/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer', 'admin'], owner: 'users.id = caller',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/customers/[id]/route.js:135-136, requireCaller(request, [customer, admin]): no credential is 401 and a wrong role 403 before the body is read). Ownership (users.id = caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/customers/[id]/route.js:143. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Role not checked: mobile/Google provider tokens carry id, so provider N passes as customer N; a… Probe (B2, 2026-10-02; QA F7): allowed [403, 404]. An ownership row: the probe id is nobody own, so the ALLOWED customer is refused 403 by the handler own ownership check (customers/[id]/route.js:151-153) and the allowed admin gets 404 (no user 999999999, :193-195). Either status is legitimate for an allowed role; a 401 is not. Today the admin cookie answers 401, because the handler reads only the customer_token cookie (:140), and that stays wrong.',
        probe: { path: '/api/customers/999999999', body: undefined, anon: 401, allowed: [403, 404] },
    },
    {
        route: '/api/customers/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'users.id = caller',
        note: 'ENG-023, converted: the guard is the first statement of PUT (src/app/api/customers/[id]/route.js:224-225, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (users.id = caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/customers/[id]/route.js:232. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Upload extension comes from client filename, no type/size check, written to public/uploads (L28… Probe (B2, 2026-10-02; QA F7): allowed [400, 403, 404]. An ownership row: the probe id is nobody own, so the ALLOWED customer is refused 403 by the ownership check (customers/[id]/route.js:249-251), which runs before the body is read (:253-271), the file write (:279-295) and the UPDATE (:315). A conversion that answers 404 for a missing user, or validates first and answers 400 (first_name and last_name are required, :273-275), is as legitimate; a 401 is not. No credential reaches a write with {}.',
        probe: { path: '/api/customers/999999999', body: {}, anon: 401, allowed: [400, 403, 404] },
    },
    {
        route: '/api/directory', method: 'GET', today: 'none', kind: 'public', public: 'public catalogue (SEO directory)', owner: '-',
        note: 'Error body returns error.message (L48), leaking DB error text; otherwise only active catalogue … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/directory', body: undefined, anon: [200] },
    },
    {
        route: '/api/locations', method: 'GET', today: 'none', kind: 'public', public: 'public picklists', owner: '-',
        note: 'Parameterized queries; no sensitive data; unauthenticated by design. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/locations', body: undefined, anon: [200] },
    },
    {
        route: '/api/mobile/push-token', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'body userId must equal caller',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/mobile/push-token/route.js:6-7, requireCaller(request, [customer, provider, admin]): no credential is 401 and a wrong role 403 before the body is read; admin is in the row since round 2 of ENG-023, for the admin signed in on the app, who registers a device like any role: design Amendment 7, which replaces the customer, provider of the Appendix A row). The body userId must equal auth.caller.id and a named userType must be the caller role (an admin may also name customer, which is what the app sends for every role that is not a provider); the stored user_type and the column are chosen from caller.role, never from the body; 403 refusals src/app/api/mobile/push-token/route.js:25. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Auth is log-only (L22-24), identity from body: anyone can overwrite any account\'s push token or…',
        probe: { path: '/api/mobile/push-token', body: {}, anon: 401 },
    },
    {
        route: '/api/payment/create-intent', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'own booking',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/payment/create-intent/route.js:15-16, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). The route takes no booking (the body is the service and the price; the booking is made after the payment), so the row owner text own booking has no referent: the owner is the users row of caller.id (src/app/api/payment/create-intent/route.js:39, from auth.caller and never from a request field), and a body user_id or booking_id naming another account is a 403, src/app/api/payment/create-intent/route.js:25, :30. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Charge amount comes from client body service_price (L56-60), not re-read from services; error b…',
        probe: { path: '/api/payment/create-intent', body: {}, anon: 401 },
    },
    {
        route: '/api/provider', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/provider/route.js:175-176), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Branches: ?id missing gives 400; ?id=N gives full cascade delete. Anyone on the internet can ir…',
        probe: { path: '/api/provider', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/provider/route.js:11-12), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Branches: (a) ?id=X returns one provider incl. email and phone (L18-28); (b) ?status=S returns …',
        probe: { path: '/api/provider', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin', 'provider'], owner: 'the no-`id` branch updates `caller.id` (today `decoded.id` from any role\'s Bearer, `provider/route.js:121-163`; read by me)',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\', \'provider\']) as its first statements (src/app/api/provider/route.js:54-55), before the body is read: no credential is 401 and a customer 403. The split is in the handler: the `?id=` branches (a status change, or a full edit of any provider) are the admin\'s, so a provider naming any provider, their own included, is 403; the no-`id` branch (from the comment at L127) is the provider\'s own profile and updates auth.caller.id, never a query or body value, and an admin there is 403 (there is no provider profile to update). Probe: path /api/provider with {} and no query is the no-`id` branch: a provider reaches the 400 validation (name, email and phone are required) before any UPDATE and an admin is 403, so probe.allowed is [400, 403], which also lets a provider\'s 403 pass; the exact legs (the admin\'s `?id=` branch, a provider\'s 403 on it, the provider\'s own row) are the PUT /api/provider cases of e2e/role-checks.spec.js. Census finding before the guard: Target in Appendix A: admin (`?id=` branches), provider (no-`id` branch); a customer is refused. Census: Branches: (A) ?id=X with body exactly {status}: sets any provider to active/inactive/suspended/…',
        probe: { path: '/api/provider', body: {}, anon: 401, allowed: [400, 403] },
    },
    {
        route: '/api/provider/availability', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own availability flag',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/availability/route.js:7-8, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own availability flag) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/availability/route.js:10. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Sound gate; no check on provider status, so suspended or deleted providers with a live token st…',
        probe: { path: '/api/provider/availability', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/availability', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own availability flag',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/availability/route.js:28-29, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own availability flag) comes from auth.caller, never from a request field; auth.caller read at src/app/api/provider/availability/route.js:30. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Can run ALTER TABLE service_providers from the request path after an UPDATE error (L72-76); err… Probe (B2, 2026-10-02): body undefined. availability/route.js:62 reads the body (`await request.json()`) before the first side effect, the UPDATE at :66-69 and, after its error, the ALTER TABLE at :74-76, so a request with no body throws there and the catch at :93 answers 500: nothing is written and no schema is changed, for any credential. The old probe, {}, passed :62 and set the fixture provider offline (the is_available column exists on the dev schema, so the ALTER TABLE did not run).',
        probe: { path: '/api/provider/availability', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/availability', method: 'PUT', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own availability flag',
        note: 'ENG-023, converted: the guard is the first statement of PUT (src/app/api/provider/availability/route.js:34-35, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own availability flag) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/availability/route.js:42. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Identical to POST via handleToggle (L42-44), including the ALTER TABLE fallback and the error.m… Probe (B2, 2026-10-02): body undefined, for the reason given on POST (handleToggle reads the body at availability/route.js:62, before the UPDATE at :66-69; the catch at :93 answers 500; nothing is written).',
        probe: { path: '/api/provider/availability', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned jobs plus the open pool',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/available-jobs/route.js:22-23, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own assigned jobs plus the open pool) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/available-jobs/route.js:29. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): ?all=true removes the service-area filter (L128); postal_code unmasked (L198) while address_lin…',
        probe: { path: '/api/provider/available-jobs', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'claims open jobs',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/available-jobs/route.js:304-305, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (claims open jobs) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/available-jobs/route.js:308. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Any provider token can accept any open job: no approval, onboarding, status, area or availabili…',
        probe: { path: '/api/provider/available-jobs', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs/[id]', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job, or an open-pool job (provider_id IS NULL); never another provider\'s',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/available-jobs/[id]/route.js:24-25, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own job, or an open-pool job (provider_id IS NULL); never another providers) comes from auth.caller, never from a request field; 403 refusals src/app/api/provider/available-jobs/[id]/route.js:55. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): IDOR: any provider reads full address, instructions and assigned provider_id of ANY booking id …',
        probe: { path: '/api/provider/available-jobs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs/[id]', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job, or an open-pool job (provider_id IS NULL); never another provider\'s',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/available-jobs/[id]/route.js:118-119, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own job, or an open-pool job (provider_id IS NULL); never another providers) comes from auth.caller, never from a request field; 403 refusals src/app/api/provider/available-jobs/[id]/route.js:148. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): No active/approved status check; customer-notify code reads job.user_id and customer_email neve…',
        probe: { path: '/api/provider/available-jobs/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/bookings', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned bookings',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/bookings/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own assigned bookings) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/bookings/route.js:9. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): ?status= comma list is bound as parameters (L48-52), no injection; shows customer names for own…',
        probe: { path: '/api/provider/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/check-verification', method: 'GET', today: 'none', kind: 'public', public: 'pre-login verification status (enumeration noted, rate limits are a non-goal)', owner: '-',
        note: 'Account enumeration: 404 vs 200 reveals whether an email is a registered provider and whether i… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 400 \'Email is required\'.',
        probe: { path: '/api/provider/check-verification', body: undefined, anon: [400] },
    },
    {
        route: '/api/provider/dashboard-stats', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own stats',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/dashboard-stats/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own stats) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/dashboard-stats/route.js:10. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Sound gate and ownership; no provider status check.',
        probe: { path: '/api/provider/dashboard-stats', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/forgot-password', method: 'POST', today: 'none', kind: 'public', public: 'reset request', owner: '-',
        note: 'Enumeration via 404 vs 200; client-chosen source=mobile gives 6-digit Math.random OTP (L355-358… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email is required\'.',
        probe: { path: '/api/provider/forgot-password', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/jobs', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned jobs',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/jobs/route.js:7-8, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own assigned jobs) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/jobs/route.js:10. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Returns customer email and phone for every own job incl. completed and cancelled (L52-55); no s…',
        probe: { path: '/api/provider/jobs', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/[id]', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job, or an open-pool job; never another provider\'s',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/jobs/[id]/route.js:7-8, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own job, or an open-pool job; never another providers) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/jobs/[id]/route.js:28. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): SELECT b.* (L31) returns the full booking row incl. customer contact and address for any unassi…',
        probe: { path: '/api/provider/jobs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/photos', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'photos of own assigned jobs',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/jobs/photos/route.js:112-113, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (photos of own assigned jobs) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/jobs/photos/route.js:130. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Ownership verified before reading (L156-166); SELECT * returns all job_photos columns.',
        probe: { path: '/api/provider/jobs/photos', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/photos', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'photos on own assigned jobs',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/jobs/photos/route.js:11-12, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (photos on own assigned jobs) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/jobs/photos/route.js:40, :71. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): photo_url is any client string stored unvalidated (L31,85), may be an external URL; EXIF read o…',
        probe: { path: '/api/provider/jobs/photos', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/jobs/time-tracking', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job timer',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/jobs/time-tracking/route.js:559-560, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own job timer) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/jobs/time-tracking/route.js:580. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Sound ownership (L571); cookie-only, so Bearer mobile clients cannot call it.',
        probe: { path: '/api/provider/jobs/time-tracking', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/time-tracking', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned job',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/jobs/time-tracking/route.js:11-12, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own assigned job) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/jobs/time-tracking/route.js:35, :60, :116, :136, :153, :238 .... Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Client-supplied submitted_duration_minutes and submitted_headcount (L185,191) set final_provide…',
        probe: { path: '/api/provider/jobs/time-tracking', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/login', method: 'POST', today: 'none', kind: 'public', public: 'provider login', owner: '-',
        note: 'Rejected-status reply with rejection_reason is sent BEFORE the password check (L188-195); 401 t… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and password required\'.',
        probe: { path: '/api/provider/login', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/logout', method: 'POST', today: 'none', kind: 'public', public: 'logout', owner: '-',
        note: 'Clears cookie only; JWT stays valid until expiry (no server-side revocation) and mobile Bearer … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 200.',
        probe: { path: '/api/provider/logout', body: {}, anon: [200] },
    },
    {
        route: '/api/provider/me', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/me/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own profile) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/me/route.js:11. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Bad or expired token yields 500 not 401 (still refused); logs the whole provider record (L65), …',
        probe: { path: '/api/provider/me', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/complete', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own onboarding',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/onboarding/complete/route.js:7-8, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own onboarding) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/onboarding/complete/route.js:9. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Reads docs and Stripe status (L39-48) but never enforces them; status IF(active, active, pendin… Probe (B2, 2026-10-02): holdAllowed. The handler never reads the body, so a request from an ALLOWED provider, whatever it carries, runs the UPDATE of onboarding_completed, onboarding_step and status at complete/route.js:54-63 and mails ADMIN_EMAIL, whose default is a real person address, at :83-90. The provider cookie and the provider Bearer are therefore not sent. None and every wrong role are sent: each stops at the 401 at :28-34 (no provider_token cookie, no providerId in a customer Bearer session) before any of it. Keep the hold until the converting ticket proves the allowed path another way (a fixture provider the handler may rewrite, or a stub of the mail send).',
        probe: { path: '/api/provider/onboarding/complete', body: {}, anon: 401, holdAllowed: 'an allowed provider request rewrites onboarding_completed, onboarding_step and status (complete/route.js:54-63) and mails ADMIN_EMAIL (:83-90) whatever the body' },
    },
    {
        route: '/api/provider/onboarding/create-stripe-account', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own payout account',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/onboarding/create-stripe-account/route.js:9-10, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own payout account) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/onboarding/create-stripe-account/route.js:11. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Client refreshUrl and returnUrl are forwarded to Stripe as redirect targets (L40-45); error bod… Probe (B2, 2026-10-02): body undefined. create-stripe-account/route.js:36 reads the body (`await request.json()`) before the first database read (:48) and before every Stripe call (:70, :73, :92), so a request with no body throws there and the catch at :148 answers 500: no outbound call, no write. The old probe, {}, passed :36 and reached stripe.accounts.create at :92.',
        probe: { path: '/api/provider/onboarding/create-stripe-account', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/documents', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own KYC documents',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/onboarding/documents/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own KYC documents) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/onboarding/documents/route.js:8. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Returns admin_notes (internal reviewer notes, L33) and ID or insurance document_url to the prov…',
        probe: { path: '/api/provider/onboarding/documents', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/profile', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/onboarding/profile/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own profile) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/onboarding/profile/route.js:8. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Only bio is validated (L34-43); other fields unvalidated; resets onboarding_step to 2 even for …',
        probe: { path: '/api/provider/onboarding/profile', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/stripe-complete', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own payout account',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/onboarding/stripe-complete/route.js:9-10, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Which provider row is read and written comes from auth.caller (providerId = caller.id, src/app/api/provider/onboarding/stripe-complete/route.js:11, bound in every query of the handler), but the Stripe account id that is stored does NOT: it is still the request body accountId (src/app/api/provider/onboarding/stripe-complete/route.js:18), and nothing checks that the account belongs to this provider, so this conversion is the guard and the caller row only and is not an ownership check of the payout account (the backend seat proposal row of 2026-10-04 in agents/eng-manager/proposals.md describes the fix; the security gate follows it). Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s) and STILL TRUE after it: Client body accountId (L39) is stored as payout account and can mark onboarding complete from a… Probe (B2, 2026-10-02): body undefined. stripe-complete/route.js:38 reads the body (`await request.json()`) before the first database read (:43), the Stripe call (:63) and the UPDATE at :107, so a request with no body throws there and the catch at :145 answers 500: nothing is read, called or written. The old probe, {}, reached :43 and stopped at the 400 at :50-56 only because no provider has a bank-account row (provider_bank_accounts had 0 rows on the dev DB at 07:04 on 2026-10-02): harmless by data, not by construction.',
        probe: { path: '/api/provider/onboarding/stripe-complete', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/stripe-return', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own Stripe onboarding return',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/onboarding/stripe-return/route.js:135-136, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own Stripe onboarding return) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/onboarding/stripe-return/route.js:137. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): State-changing GET: cross-site navigation carries the SameSite=Lax cookie and forces onboarding… Probe (round 3, 2026-10-02): a GET has no body and no id, so nothing in the request can gate this handler. It reads only the provider_token cookie (stripe-return/route.js:140), which only the provider-cookie style carries (a Bearer style carries no cookie, e2e/auth/credentials.js:12-13), so no credential, the customer and admin cookies and both Bearers take the no-token branch at :142-144 (a redirect to /provider/login). With the provider cookie the handler selects provider_bank_accounts for provider 1 (:154-157) and an empty result redirects (:161-166). A row would reach stripe.accounts.retrieve (:172), UPDATE service_providers (:187-195) and the provider_bank_accounts upsert (:198-213); a Stripe error naming a missing account runs the UPDATE at :242 and the DELETE at :248. Two accidents stop it today. The table is empty: database/fixtures hold six files, whose sets insert into users, service_providers, service_categories, services, system_settings, bookings, invoices, provider_payouts and provider_reviews, load.js:134-136 empties every table first, and grep -c provider_bank_accounts prints 0 for each of the six files there; no probe adds a row (the other INSERT sites, create-stripe-account/route.js:124, stripe-complete/route.js:119 and stripe/webhook/route.js:256 and :270, sit behind the body reads at create-stripe-account/route.js:36 and stripe-complete/route.js:38 and the missing-signature 400 at webhook/route.js:19-24). And STRIPE_SECRET_KEY is unset on the dev app (loadEnvConfig in the app container at 08:52 on 2026-10-02, printing only set or unset), so stripe is null (:132) and :169-171 throws before :172. Harmless by data and configuration, not by construction: on the paths the probe takes (the no-token branch and the empty table) the handler ends before any side effect whether the redirect URL is built or not, and on this dev app NEXT_PUBLIC_APP_URL is unset too, so new URL(path, undefined) throws ERR_INVALID_URL at :143, :148, :163-165 and in the outer catch own redirect (:262-264) and the answer is 500 (the baseline records none (no credential): got 500). A fixture that adds a bank-account row for provider 1 must make this row holdAllowed first, in the same change, so the allowed provider is not sent; a Stripe key on the dev stack lifts the second stop. No holdAllowed is added now: it would change the recorded error text of this case in e2e/baseline.json.',
        probe: { path: '/api/provider/onboarding/stripe-return', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/update-step', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own onboarding_step',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/onboarding/update-step/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own onboarding_step) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/onboarding/update-step/route.js:8. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): step taken from body, any value or type, unvalidated (L31-47). Bearer branch also accepts email…',
        probe: { path: '/api/provider/onboarding/update-step', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/upload-document', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own onboarding documents',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/onboarding/upload-document/route.js:10-11, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own onboarding documents) comes from auth.caller, never from a request field; 403 refusals src/app/api/provider/onboarding/upload-document/route.js:38. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Path built L116-119: path.join(public/uploads/providers, `${providerId}-${documentType}-${Date.…',
        probe: { path: '/api/provider/onboarding/upload-document', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/payouts', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own earnings and payouts',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/payouts/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own earnings and payouts) comes from auth.caller, never from a request field; 403 refusals src/app/api/provider/payouts/route.js:14. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Cookie only (mobile Bearer not supported); no suspended/deleted-status check on a 7-day token; …',
        probe: { path: '/api/provider/payouts', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/profile', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/profile/route.js:149-150, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own profile) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/profile/route.js:154. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Cookie only; no password hash selected; L1-130 is a commented-out older copy of the file (dead …',
        probe: { path: '/api/provider/profile', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/profile', method: 'PUT', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'ENG-023, converted: the guard is the first statement of PUT (src/app/api/provider/profile/route.js:261-262, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own profile) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/profile/route.js:267. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Explicit column allowlist (status not writable), but email and phone change with no re-verifica…',
        probe: { path: '/api/provider/profile', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/ratings', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own reviews',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/ratings/route.js:118-119, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own reviews) comes from auth.caller, never from a request field; 403 refusals src/app/api/provider/ratings/route.js:126. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Cookie only; shows reviewer first and last name unless is_anonymous (L185); L1-111 is a comment…',
        probe: { path: '/api/provider/ratings', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/reset-password', method: 'POST', today: 'partial', kind: 'public', public: 'reset completion; guard is the token/OTP (see S1)', owner: '-',
        note: 'ENG-022 S1 (2026-10-03, 7a86bc2): before the query the handler refuses with 400 { success: false, message: \'Valid token or Email/OTP required\' } any token, email or otp that is present and is not a string (src/app/api/provider/reset-password/route.js:28-35). On this route connection.execute() is a prepared statement (as is execute() in src/lib/db.js:47-51), so the raw token was a typed bind, never SQL text (route.js:61; an array or object goes as a JSON-typed bind, and what MySQL makes of a typed token is not claimed here); a non-string email threw at .trim() (route.js:46), before any query, so it was a 500, and otp is stringified into cleanOtp (route.js:47, bound at route.js:93). The check refuses all three with 400; a string is handled as before. The exploitability probe of the unfixed code did NOT run (see 7a86bc2), so the finding below is from code reading and was not exercised; the cases that pin the 400 are in e2e/s1-reset-otp.spec.js. Census finding, line numbers moved to this file: Token path needs no email and the 6-digit mobile OTP lives in the same reset_token column, so a… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Password required\'.',
        probe: { path: '/api/provider/reset-password', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/signup', method: 'POST', today: 'none', kind: 'public', public: 'provider signup', owner: '-',
        note: 'No rate limit or captcha; reveals registered emails and phones (L205, L218, L231); OTP from Mat… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'All fields are required\'.',
        probe: { path: '/api/provider/signup', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/status', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own status',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/provider/status/route.js:6-7, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own status) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/status/route.js:13. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Bearer branch also accepts email_verification/password_reset JWTs (carry providerId) with no ac…',
        probe: { path: '/api/provider/status', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/upload', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own documents and avatar',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/provider/upload/route.js:115-116, requireCaller(request, [provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own documents and avatar) comes from auth.caller, never from a request field; caller.id bound at src/app/api/provider/upload/route.js:117. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Path built L150-160: path.join(public/uploads, `${providerId}-${documentType}-${Date.now()}${pa…',
        probe: { path: '/api/provider/upload', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/validate-reset-token', method: 'GET', today: 'none', kind: 'public', public: 'reset page link check (see S1)', owner: '-',
        note: 'ENG-022 S1 (2026-10-03): no edit was needed here: the token is searchParams.get(\'token\'), which is a string or null by construction, and `if (!token)` is already the 400 (\'Token required\'), so no non-string value can reach the query. The oracle itself (a live reset_token, 6-digit OTPs included, answers valid) is unchanged by this ticket. Census finding: Unauthenticated oracle for live reset_token values including 6-digit mobile OTPs, no email need… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 400 \'Token required\'.',
        probe: { path: '/api/provider/validate-reset-token', body: undefined, anon: [400] },
    },
    {
        route: '/api/provider/verify-email', method: 'GET', today: 'full', kind: 'public', public: 'emailed verification link (signed token)', owner: '-',
        note: 'State-changing GET. JWT branch selects WHERE email=? OR id=? (L29-34), so a stale token can hit… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 400 \'No verification token provided\'. Probe (round 3, 2026-10-02): a public row, so every credential style reaches the handler, and the handler reads no credential (it reads only the token query, verify-email/route.js:11-12). Its first side effect is the UPDATE service_providers that marks the provider verified and clears the stored token, at :49-57 (JWT branch) and at :114-122 (stored-token branch). The probe sends no token query, so every style stops at the 400 at :16-21, before any read or write: a validation, not data. A probe with a token query would reach the lookups at :29-34 and :72-77 and, for a token that verifies or matches a stored one, the UPDATE.',
        probe: { path: '/api/provider/verify-email', body: undefined, anon: [400] },
    },
    {
        route: '/api/provider/verify-otp', method: 'POST', today: 'partial', kind: 'public', public: 'OTP check (see S1)', owner: '-',
        note: 'ENG-022 S1 (2026-10-03, 7a86bc2): before the query the handler refuses with 400 { success: false, message: \'Email and verification code required\' } an email or otp that is not a string (a missing one gets the 400 it always got) (src/app/api/provider/verify-otp/route.js:16-23). No non-string request value ever reached execute() in this route: a non-string email threw at .trim() (route.js:25), before the query, so it was a 500, and otp is stringified into cleanOtp (route.js:26) and bound as a string. The check turns that 500 into a 400 and stops a JSON-number otp being coerced into a string that could match a stored code; a string is handled as before. The exploitability probe of the unfixed code did NOT run (see 7a86bc2), so the finding below is from code reading and was not exercised; the cases that pin the 400 are in e2e/s1-reset-otp.spec.js. Census finding, line numbers moved to this file: 6-digit OTP, no rate limit or lockout, not consumed (so it also opens reset-password); expiry N… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and verification code required\'.',
        probe: { path: '/api/provider/verify-otp', body: {}, anon: [400] },
    },
    {
        route: '/api/reviews', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/reviews/route.js:274-275), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Unauthenticated delete of any review by sequential id; provider ratings are recomputed afterwar…',
        probe: { path: '/api/reviews', body: undefined, anon: 401 },
    },
    {
        route: '/api/reviews', method: 'GET', today: 'none', kind: 'roles', roles: ['customer', 'admin'], owner: 'customer: reviews of own bookings',
        note: 'Before ENG-021 anyone got this and now an admin does (a customer gets only the reviews of their own bookings): with no filter it returns every review with customer name and customer_email (L121-122) even when is_an… ENG-021 guard: src/app/api/reviews/route.js:103-104 calls requireCaller(request, [\'customer\', \'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. A customer_id naming anyone else is 403 for a customer (:114-116), and a customer\'s list is limited to reviews of their own bookings by AND b.user_id = caller.id (:137-140).',
        probe: { path: '/api/reviews', body: undefined, anon: 401 },
    },
    {
        route: '/api/reviews', method: 'POST', today: 'none', kind: 'roles', roles: ['customer'], owner: 'own completed booking; customer_id from caller',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/reviews/route.js:186-187, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own completed booking; customer_id from caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/reviews/route.js:219, :236, :237. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Anyone can post a review as any customer for any completed booking, attach it to any provider_i…',
        probe: { path: '/api/reviews', body: {}, anon: 401 },
    },
    {
        route: '/api/seo', method: 'GET', today: 'none', kind: 'public', public: 'public page metadata', owner: '-',
        note: 'Returns header_scripts/footer_scripts blobs from seo_settings (seo.js) to anyone, public by des… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/seo', body: undefined, anon: [200] },
    },
    {
        route: '/api/service-areas', method: 'GET', today: 'none', kind: 'public', public: 'public catalogue', owner: '-',
        note: 'Read-only catalogue of active rows; nothing sensitive. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/service-areas', body: undefined, anon: [200] },
    },
    {
        route: '/api/service-locations', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/service-locations/route.js:202-203), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Unauthenticated delete of any service-location page by id; 500 echoes error.message (L215).',
        probe: { path: '/api/service-locations', body: undefined, anon: 401 },
    },
    {
        route: '/api/service-locations', method: 'GET', today: 'none', kind: 'public', public: 'landing pages; `?admin=`/`?includeInactive=` branches require admin', owner: '-',
        note: 'ENG-022: public by design (landing pages, the booking flow), so no guard. ?includeInactive=true or ?admin=true (L14) drops the is_active filter (draft rows) and is honoured only for an admin caller: callerFrom(request, [\'admin\']) at src/app/api/service-locations/route.js:16, the filter at L33; for everyone else the flags are ignored and the answer is exactly the one the request without them gets (no refusal). Census finding before the change: both flags worked with no auth (L13 at 1d67c30). Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body, before the change: 200 (the probe sends no flag, so it is the same request now).',
        probe: { path: '/api/service-locations', body: undefined, anon: [200] },
    },
    {
        route: '/api/service-locations', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/service-locations/route.js:81-82), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Unauthenticated write of public page content (canonical_url, intro, description) that feeds /ap…',
        probe: { path: '/api/service-locations', body: {}, anon: 401 },
    },
    {
        route: '/api/services', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: DELETE calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/services/route.js:326-327), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Unauthenticated delete of any service; image_url is client-set via POST/PUT, so the unlink can …',
        probe: { path: '/api/services', body: undefined, anon: 401 },
    },
    {
        route: '/api/services', method: 'GET', today: 'none', kind: 'public', public: 'catalogue; the `?admin=true` branch requires admin', owner: '-',
        note: 'ENG-022: public by design (the catalogue the landing pages and the booking flow read), so no guard. ?admin=true drops the is_active filter and exposes all s.* columns, and it is honoured only for an admin caller: callerFrom(request, [\'admin\']) at src/app/api/services/route.js:19, the filter at L61; for everyone else the flag is ignored and the answer is exactly the one the request without the flag gets (no refusal). Census finding before the change: the flag worked with no auth (L17, L59 at 1d67c30). Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body, before the change: 200 (the probe sends no flag, so it is the same request now).',
        probe: { path: '/api/services', body: undefined, anon: [200] },
    },
    {
        route: '/api/services', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/services/route.js:140-141), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Unauthenticated creation of services with attacker-chosen price, slug, image_url and skills; au…',
        probe: { path: '/api/services', body: {}, anon: 401 },
    },
    {
        route: '/api/services', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: PUT calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/services/route.js:221-222), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Unauthenticated price, name, slug or active-flag change on any service (price source for bookin…',
        probe: { path: '/api/services', body: {}, anon: 401 },
    },
    {
        route: '/api/skills', method: 'GET', today: 'none', kind: 'public', public: 'public catalogue', owner: '-',
        note: 'Read-only catalogue; nothing sensitive. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/skills', body: undefined, anon: [200] },
    },
    {
        route: '/api/stats', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: GET calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/stats/route.js:6-7), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Anyone can read platform-wide business metrics: totalRevenue (L47, L106), bookings by status, c…',
        probe: { path: '/api/stats', body: undefined, anon: 401 },
    },
    {
        route: '/api/stripe/webhook', method: 'GET', today: 'none', kind: 'public', public: 'health ping, returns no data', owner: '-',
        note: 'Returns {message,timestamp} only (L385-390); harmless. Probe measured on the dev app at 04:51 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/stripe/webhook', body: undefined, anon: [200] },
    },
    {
        route: '/api/stripe/webhook', method: 'POST', today: 'full', kind: 'self', self: 'Stripe signature, verified before any branch (unchanged)', owner: '-',
        note: 'Signature verified once (L41) before the event switch (L51), so every branch is covered; fails … Probe measured on the dev app at 04:51 on 2026-10-02 with no credential and an empty JSON body: 400 \'Missing stripe-signature header\'. 500 is accepted for a server with no webhook secret.',
        probe: { path: '/api/stripe/webhook', body: {}, anon: [400, 500] },
    },
    {
        route: '/api/test/push', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'ENG-022: POST calls requireCaller(request, [\'admin\']) as its first statements (src/app/api/test/push/route.js:7-8), before the body or the database is read: no credential is 401, any other role 403, and the admin gets what it got. Census finding before the guard, line numbers moved to this file: Test endpoint left live: anyone can push arbitrary title and body to any user or provider id, o…',
        probe: { path: '/api/test/push', body: {}, anon: 401 },
    },
    {
        route: '/api/upload', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Until ENG-021 anyone could delete (now only an admin can) any file in public/uploads by name, including provider documents and … ENG-021 guard: src/app/api/upload/route.js:72-73 calls requireCaller(request, [\'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403.',
        probe: { path: '/api/upload', body: undefined, anon: 401 },
    },
    {
        route: '/api/upload', method: 'POST', today: 'none', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: '-',
        note: 'Path built L45-48: path.join(public/uploads, `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/… ENG-021 guard: src/app/api/upload/route.js:8-9 calls requireCaller(request, [\'customer\', \'provider\', \'admin\']) as the method\'s first statements, so a request with no session gets 401 and a role the row does not allow gets 403. The guard is ahead of request.formData() at :11, so a refused request is not buffered and nothing is written.',
        probe: { path: '/api/upload', body: {}, anon: 401 },
    },
    {
        route: '/api/user/addresses', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/user/addresses/route.js:13-14, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (user_id = caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/user/addresses/route.js:17. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Any valid JWT accepted: provider and admin mobile tokens carry id = their own table id (auth/mo…',
        probe: { path: '/api/user/addresses', body: undefined, anon: 401 },
    },
    {
        route: '/api/user/addresses', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'ENG-023, converted: the guard is the first statement of POST (src/app/api/user/addresses/route.js:33-34, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (user_id = caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/user/addresses/route.js:41. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Same flaw: provider or admin token id used as users.id, so a provider writes addresses into the…',
        probe: { path: '/api/user/addresses', body: {}, anon: 401 },
    },
    {
        route: '/api/user/addresses/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'ENG-023, converted: the guard is the first statement of DELETE (src/app/api/user/addresses/[id]/route.js:53-54, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (user_id = caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/user/addresses/[id]/route.js:64. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Same id-namespace flaw: a provider or admin token with the matching numeric id can delete that …',
        probe: { path: '/api/user/addresses/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/user/addresses/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'ENG-023, converted: the guard is the first statement of PUT (src/app/api/user/addresses/[id]/route.js:8-9, requireCaller(request, [customer]): no credential is 401 and a wrong role 403 before the body is read). Ownership (user_id = caller) comes from auth.caller, never from a request field; 403 refusals src/app/api/user/addresses/[id]/route.js:22. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Same id-namespace flaw; SET list built from fixed column names only (L37-42), so no injection.',
        probe: { path: '/api/user/addresses/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/user/settings', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer', 'provider'], owner: 'own row',
        note: 'ENG-023, converted: the guard is the first statement of GET (src/app/api/user/settings/route.js:13-14, requireCaller(request, [customer, provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own row) comes from auth.caller, never from a request field; 403 refusals src/app/api/user/settings/route.js:18. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Admin or other-role token falls through to users by decoded.id (low impact); web provider token…',
        probe: { path: '/api/user/settings', body: undefined, anon: 401 },
    },
    {
        route: '/api/user/settings', method: 'PUT', today: 'partial', kind: 'roles', roles: ['customer', 'provider'], owner: 'own row',
        note: 'ENG-023, converted: the guard is the first statement of PUT (src/app/api/user/settings/route.js:53-54, requireCaller(request, [customer, provider]): no credential is 401 and a wrong role 403 before the body is read). Ownership (own row) comes from auth.caller, never from a request field; 403 refusals src/app/api/user/settings/route.js:63. Before the conversion, as the census wrote it at 43cdcee (its cited line numbers are 43cdcee numbers, not the current file\'s): Same: admin or other-role token writes the users row with the same numeric id (low impact); onl…',
        probe: { path: '/api/user/settings', body: {}, anon: 401 },
    },
];
