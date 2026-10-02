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
//   - The other 195 rows have no such line; 50 of them (36 public, 13 self, 1 pending) carry a `Probe measured on the dev
//     app` line instead, which records the status measured there for the request with no credential and no body. Their
//     probes were read in code-review round 1 (ENG-020 ticket log), and the only commit that touched this file after
//     1aed079 is the B2 commit (475f453): for those 195 rows the row object, apart from `note`, equals the one at 1aed079
//     (script compare, 195 of 195). A row without a `Probe (` line is not a finding that its probe is harmless.
//   - The whole suite's run is MEASURED, not argued: `CHECKSUM TABLE` over the 33 tables before and after, and a grep of the
//     app log for mail, SMTP, Stripe-account and `ALTER TABLE` lines. The runs recorded in the ENG-020 ticket log (build
//     round 2's two windows and QA round 2's full run) differ in `activity_logs` and `mobile_auth_users` and in no other
//     table, with 0 mail, 0 SMTP, 0 `Stripe account created` or `Reusing existing Stripe account` and 0 `ALTER TABLE` lines.
//     That is what those greps can show; a Stripe call that logs none of those lines would not appear in them.
//   - One class is not a per-row fact and has no note: an id-keyed write whose probe id (PROBE_IDS.missing, 999999999)
//     matches no row. It is harmless while no row has that id, which depends on the fixtures and on nothing in the row.
// Where one request from a caller the row allows (or from any caller) does real work, the row is held, with its reason in
// `probe.hold` or `probe.holdAllowed`. The held rows are:
//   hold         GET /api/cron/auto-release, GET /api/cron/notifications  (until ENG-022 adds requireCronSecret)
//   holdAllowed  POST /api/provider/onboarding/complete                   (keep the hold until the converting ticket proves the
//                                                                         allowed path another way: a fixture provider the
//                                                                         handler may rewrite, or a stub of the mail send)
// Remove a hold in the same change that converts its handler, not before. No imports, so plain Node and Playwright read
// this file the same way.

export const PROBE_IDS = { missing: 999999999 };

export const matrix = [
    {
        route: '/api/admin/blogs', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth; returns every blog row including drafts (is_published ignored).',
        probe: { path: '/api/admin/blogs', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/blogs', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Anyone can publish posts; public src/app/blogs/[id]/page.js:205 renders content via dangerously…',
        probe: { path: '/api/admin/blogs', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/blogs/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth; any blog, including unpublished, readable by sequential id.',
        probe: { path: '/api/admin/blogs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/blogs/[id]', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Anyone can overwrite any post; content is rendered raw on the public page (blogs/[id]/page.js:2…',
        probe: { path: '/api/admin/blogs/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/blogs/[id]', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Anyone can hard-delete any blog by sequential id.',
        probe: { path: '/api/admin/blogs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/bookings/[id]/override', method: 'PUT', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Role trusted from JWT claim, no DB re-check; worker_count and actual_duration_minutes unvalidat…',
        probe: { path: '/api/admin/bookings/999999999/override', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/cities', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'verifyAdmin is a signature check only: any customer, provider, mobile or email-verification JWT…',
        probe: { path: '/api/admin/cities', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/cities', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check: any signed-up customer or provider can create cities. Cookie only, no Beare…',
        probe: { path: '/api/admin/cities', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/cities/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check as the cities list; low-sensitivity reference data.',
        probe: { path: '/api/admin/cities/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/cities/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check: any logged-in user can rename or deactivate a city.',
        probe: { path: '/api/admin/cities/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/cities/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check: any logged-in user can delete a city; dependent rows are not handled here.',
        probe: { path: '/api/admin/cities/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/deletion-requests', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Auth is an HTTP self-call that depends on NEXT_PUBLIC_APP_URL being right; /me reads only the a… Probe (B2, 2026-10-02): not held; see PATCH for the host the probe Cookie header goes to (deletion-requests/route.js:22-24).',
        probe: { path: '/api/admin/deletion-requests', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/deletion-requests', method: 'PATCH', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'status is free text with no allow-list; only marks the request and emails the requester, no dat… Probe (B2, 2026-10-02): not held. The fetch at deletion-requests/route.js:63-65 sends the probe Cookie header to NEXT_PUBLIC_APP_URL (default http://localhost:3000) /api/admin/me before any check. On the dev app that variable is unset (measured with loadEnvConfig in the app container at 07:00 on 2026-10-02, printing only whether it is set and the host name: not set, localhost:3000), so the header goes to the app itself. A stack that sets it to another host must hold this row. With the admin cookie the handler stops at the 400 at :72-74 (id and status are required), before any query or mail.',
        probe: { path: '/api/admin/deletion-requests', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/disputes', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: every dispute with customer/provider emails and Stripe payment_intent_id exposed. A co…',
        probe: { path: '/api/admin/disputes', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/disputes', method: 'PATCH', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Undeclared action/capture_amount/provider_amount (:105,:112) throw, so it returns 500 today; on…',
        probe: { path: '/api/admin/disputes', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/disputes/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: any dispute by sequential id with customer/provider emails, Stripe account id and paym…',
        probe: { path: '/api/admin/disputes/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/districts', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check as cities: any customer, provider or mobile token in the adminAuth cookie pa…',
        probe: { path: '/api/admin/districts', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/districts', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check: any signed-up customer or provider can create districts.',
        probe: { path: '/api/admin/districts', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/districts/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check; low-sensitivity reference data.',
        probe: { path: '/api/admin/districts/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/districts/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check: any logged-in user can rename or deactivate a district.',
        probe: { path: '/api/admin/districts/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/districts/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Same any-JWT check: any logged-in user can delete a district; dependent rows are not handled he…',
        probe: { path: '/api/admin/districts/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/earnings', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: platform revenue, commission and payout totals plus every invoice row exposed. A cooki…',
        probe: { path: '/api/admin/earnings', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth; with no filter it returns every invoice row; any invoice readable by id or booking_id.',
        probe: { path: '/api/admin/invoices', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices', method: 'PATCH', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth; arbitrary status string, no allow-list or existence check: anyone can flip any invoice…',
        probe: { path: '/api/admin/invoices', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/invoices/[id]/preview', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: customer PII by sequential invoice id; booking fields go unescaped into the HTML (stor…',
        probe: { path: '/api/admin/invoices/999999999/preview', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices/[id]/preview/download', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: each request launches headless Chrome (DoS) on HTML with unescaped customer-supplied f…',
        probe: { path: '/api/admin/invoices/999999999/preview/download', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/invoices/generate', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: anyone can create or overwrite customer and provider invoice amounts for any booking; …',
        probe: { path: '/api/admin/invoices/generate', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/login', method: 'POST', today: 'none', kind: 'public', public: 'admin login (credential exchange)', owner: '-',
        note: 'No rate limit or lockout seen (brute force); unknown email returns before bcrypt (timing oracle… Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and password are required\'.',
        probe: { path: '/api/admin/login', body: {}, anon: [400] },
    },
    {
        route: '/api/admin/logout', method: 'POST', today: 'none', kind: 'public', public: 'logout, clears own cookie', owner: '-',
        note: 'Stateless JWT is not revoked: a stolen adminAuth token stays valid up to 24h after logout. Probe measured on the dev app at 04:49 on 2026-10-02 with no credential and an empty JSON body: 200.',
        probe: { path: '/api/admin/logout', body: {}, anon: [200] },
    },
    {
        route: '/api/admin/logs', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: the whole audit trail is readable; limit is uncapped; limit/offset are parseInt-ed bef…',
        probe: { path: '/api/admin/logs', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/me', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Strongest check in this set (DB-backed role) but keyed on payload.id only; token role/type igno…',
        probe: { path: '/api/admin/me', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/notifications', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: 'notifications where user_id=token id and user_type=\'admin\'',
        note: 'Only route in this set accepting both Bearer and cookie. Role comes from the JWT claim, no DB r…',
        probe: { path: '/api/admin/notifications', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/notifications', method: 'PUT', today: 'full', kind: 'roles', roles: ['admin'], owner: 'notifications of the token\'s admin',
        note: 'Ownership enforced in the WHERE clause, so a body id cannot touch another admin\'s rows; role fr…',
        probe: { path: '/api/admin/notifications', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/payouts', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: provider balances, emails and Stripe payout/transfer ids exposed. A cookie-only fix wo…',
        probe: { path: '/api/admin/payouts', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/provider-jobs', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: response includes the whole provider row (password hash, reset_token, email_verificati…',
        probe: { path: '/api/admin/provider-jobs', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Token read then ignored. sp.* leaks every provider\'s password hash, live reset_token and email_…',
        probe: { path: '/api/admin/providers', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Anyone can approve or reject any provider; rejectionReason goes unescaped into an email sent fr…',
        probe: { path: '/api/admin/providers', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: anyone can rewrite any provider\'s email then use forgot-password: account takeover. \'E…',
        probe: { path: '/api/admin/providers/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: irreversible cascade hard-delete of a provider and all their bookings, invoices, chat …',
        probe: { path: '/api/admin/providers/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]/documents', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: provider contact data and all KYC document records for any provider id; error.message …',
        probe: { path: '/api/admin/providers/999999999/documents', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/providers/[providerId]/documents', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: approve_all marks every KYC document verified (verification bypass); reject_all resets…',
        probe: { path: '/api/admin/providers/999999999/documents', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/providers/approve', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'No auth: approve also forces email_verified=1 and clears the verification token; suspend/reacti…',
        probe: { path: '/api/admin/providers/approve', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/seo', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'UNAUTHENTICATED despite /api/admin path (middleware guards /admin pages only, not /api); return…',
        probe: { path: '/api/admin/seo', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/seo', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'UNAUTHENTICATED write; header_scripts is rendered as a live script in head by app/layout.js:87 …',
        probe: { path: '/api/admin/seo', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/seo/[id]', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'UNAUTHENTICATED delete of any SEO row by sequential id.',
        probe: { path: '/api/admin/seo/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/seo/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'UNAUTHENTICATED read of any SEO row incl. header_scripts and footer_scripts.',
        probe: { path: '/api/admin/seo/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/seo/[id]', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'UNAUTHENTICATED overwrite of any SEO row incl. header_scripts/footer_scripts, rendered live by …',
        probe: { path: '/api/admin/seo/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-areas', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer and provider tokens share JWT_SECRET), e.g. a self-regi…',
        probe: { path: '/api/admin/service-areas', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-areas', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (same verifyAdmin as GET); creates cluster rows.',
        probe: { path: '/api/admin/service-areas', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-areas', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes; record id comes from the query string (L83); body fields not val…',
        probe: { path: '/api/admin/service-areas', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-areas/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/service-areas/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-areas/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes; also a bug: const [rows] on execute() result (L17), so a hit ret…',
        probe: { path: '/api/admin/service-areas/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-areas/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/service-areas/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-locations', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes; 500 body echoes error.message (L137).',
        probe: { path: '/api/admin/service-locations', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-locations', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any valid JWT passes and is audit-logged as actor_type admin (L232-233); description HTML rende…',
        probe: { path: '/api/admin/service-locations', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any valid JWT passes; deletes public landing-page rows; id parsed from URL (L230).',
        probe: { path: '/api/admin/service-locations/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any valid JWT passes; 500 body echoes error.message (L45).',
        probe: { path: '/api/admin/service-locations/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'PATCH', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any valid JWT passes; toggles is_active, hiding or showing public location pages.',
        probe: { path: '/api/admin/service-locations/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/service-locations/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any valid JWT passes; can rewrite slug, canonical and raw-HTML description (rendered unsanitize…',
        probe: { path: '/api/admin/service-locations/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/settings', method: 'GET', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Only DB-backed admin check in this chunk; looks id up in users only, so a mobile/Google provide…',
        probe: { path: '/api/admin/settings', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/settings', method: 'POST', today: 'full', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Writes any key/value incl. default_commission (provider commission rate); logs key and value (L…',
        probe: { path: '/api/admin/settings', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/skills', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/skills', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/skills/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/skills/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/skills/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/skills/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/states', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/states', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/states/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/states/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/states/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/states/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/testimonials', method: 'GET', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes; refusal body uses key error, not message.',
        probe: { path: '/api/admin/testimonials', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/testimonials', method: 'POST', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes; testimonial text is public site content.',
        probe: { path: '/api/admin/testimonials', body: {}, anon: 401 },
    },
    {
        route: '/api/admin/testimonials/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
        probe: { path: '/api/admin/testimonials/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/admin/testimonials/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Any validly signed JWT passes (customer or provider token in the adminAuth cookie).',
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
        note: 'Looks up users first by token id, ignoring token role: a provider token with id N hits users.id…',
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
        note: 'Reset/verification JWTs (type claim, providerId) accepted and fall to users lookup by providerI…',
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
        note: 'LOW: rotation mints a fresh 7d JWT; pending_deletion/deleted status is not checked (58-63); JWT… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Refresh token is required\'.',
        probe: { path: '/api/auth/mobile/refresh', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/reset-password', method: 'POST', today: 'partial', kind: 'public', public: 'reset completion; guard is the OTP/token (see S1)', owner: '-',
        note: 'HIGH, from code reading, not run: query() is client-side escaping (db.js:68) and body otp/token… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'New password is required\'.',
        probe: { path: '/api/auth/reset-password', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/signup', method: 'POST', today: 'none', kind: 'public', public: 'customer signup', owner: '-',
        note: 'LOW: session cookie issued with no email verification (247); body values go to client-side-esca… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Password must be at least 8 characters and contain both alphabets and \'.',
        probe: { path: '/api/auth/signup', body: {}, anon: [400] },
    },
    {
        route: '/api/auth/verify-otp', method: 'POST', today: 'partial', kind: 'public', public: 'OTP check (see S1)', owner: '-',
        note: 'MEDIUM: boolean oracle for the 6-digit reset OTP with no attempt limit; OTP not consumed; NULL … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and OTP are required\'.',
        probe: { path: '/api/auth/verify-otp', body: {}, anon: [400] },
    },
    {
        route: '/api/bookings', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL: anonymous delete of any booking plus its invoices, provider_payouts, reviews and chat…',
        probe: { path: '/api/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/bookings', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous dump of every booking (name, email, phone, address, lat/long, payment_intent_id…',
        probe: { path: '/api/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/bookings', method: 'POST', today: 'partial', kind: 'public', public: 'guest checkout; a credential, if sent, sets the owner (R1)', owner: '-',
        note: 'HIGH: payment_intent_id only checked truthy (123), never verified with Stripe (client declared … Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Missing required fields (Service, Date, Time, Address, or Email)\'.',
        probe: { path: '/api/bookings', body: {}, anon: [400] },
    },
    {
        route: '/api/bookings', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL: anonymous caller can set any booking\'s status, provider, payment_status and commissio…',
        probe: { path: '/api/bookings', body: {}, anon: 401 },
    },
    {
        route: '/api/bookings/[id]', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous read of any booking by sequential id or guessable booking_number (BK + timestam…',
        probe: { path: '/api/bookings/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/bookings/[id]/invoice/download', method: 'GET', today: 'none', kind: 'pending', pending: 'G2, the invoice-download one-way door: the approver answered option 3 on 2026-10-02 04:09 (\'build the rest first, decide this later\'), so this route stays exactly as it is today (no check) and is neither locked nor declared public until the fresh G2 is answered (the design recommends customer, admin). A browser tab cannot carry the app\'s token, so any check here breaks the app\'s two Download Invoice buttons.', owner: 'booking.user_id = caller',
        note: 'HIGH: anonymous PDF of any booking by sequential id; a plain Bearer check would break the mobil… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 404 \'Booking not found\'. The route has no check today; this status is informational and is not asserted.',
        probe: { path: '/api/bookings/999999999/invoice/download', body: undefined, anon: [404] },
    },
    {
        route: '/api/bookings/[id]/reassign', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous reassign and reset of any booking, completed or disputed included; old_provider…',
        probe: { path: '/api/bookings/999999999/reassign', body: {}, anon: 401 },
    },
    {
        route: '/api/bookings/[id]/restart', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous removal of the provider and reset to pending on any booking; no status guard, s… Probe (B2, 2026-10-02): not held, probe unchanged. The handler never reads the body. The UPDATE at restart/route.js:19-31 matches no row for 999999999, and the INSERT into booking_status_history at :34-38 is stopped only by the database: SHOW CREATE TABLE on the dev DB (structure only, 07:01 on 2026-10-02) shows booking_status_history_ibfk_1, booking_id REFERENCES bookings (id) ON DELETE CASCADE, so the INSERT fails, the transaction rolls back (:42-45) and the catch answers 500. A schema without that foreign key would store a history row for a booking that does not exist.',
        probe: { path: '/api/bookings/999999999/restart', body: {}, anon: 401 },
    },
    {
        route: '/api/categories', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous delete of any category by id; audit log is forged as Admin id 1 (127-134); effe…',
        probe: { path: '/api/categories', body: undefined, anon: 401 },
    },
    {
        route: '/api/categories', method: 'GET', today: 'none', kind: 'public', public: 'public catalogue', owner: '-',
        note: 'INFO: public by design; SELECT * returns every column of active rows (12), including any admin-… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/categories', body: undefined, anon: [200] },
    },
    {
        route: '/api/categories', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous category creation; audit log forged as Admin id 1 (47-55); icon and image_url s…',
        probe: { path: '/api/categories', body: {}, anon: 401 },
    },
    {
        route: '/api/categories', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'HIGH: anonymous update or deactivation of any category (is_active from body); audit log forged …',
        probe: { path: '/api/categories', body: {}, anon: 401 },
    },
    {
        route: '/api/chat', method: 'GET', today: 'none', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'HIGH: anonymous read of any booking\'s full chat history by sequential bookingId, with sender id…',
        probe: { path: '/api/chat', body: undefined, anon: 401 },
    },
    {
        route: '/api/chat', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'MEDIUM: any logged-in user can post into any booking\'s chat and trigger an email and push with …',
        probe: { path: '/api/chat', body: {}, anon: 401 },
    },
    {
        route: '/api/chat/mark-read', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'LOW: token only verified, never used; any logged-in user can mark any booking\'s messages read; …',
        probe: { path: '/api/chat/mark-read', body: {}, anon: 401 },
    },
    {
        route: '/api/chat/unread', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: 'participant of the booking (user_id or provider_id); admin all',
        note: 'LOW: returns only a count, but any logged-in user can probe any booking; client userType picks …',
        probe: { path: '/api/chat/unread', body: undefined, anon: 401 },
    },
    {
        route: '/api/cron/auto-release', method: 'GET', today: 'partial', kind: 'self', self: 'CRON_SECRET, made fail-closed', owner: '-',
        note: 'MEDIUM: if CRON_SECRET is unset the header \'Bearer undefined\' matches (15); development mode by… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200. The job ran for an anonymous caller. Known failure: ENG-022 makes it 401 through requireCronSecret, which also refuses with 401 when CRON_SECRET is unset, as it is on the dev app. Probe (B2, 2026-10-02): hold. In development mode every caller is authorized (auto-release/route.js:13-16), so one request, from any credential or none, runs the job: it selects the bookings awaiting approval for 24 hours (:23-33) and for each captures a Stripe payment (:46), creates a transfer (:56) and updates the booking (:69-72). Today it moves nothing only because the dev DB has no such booking (0 with a payment intent at 07:04 on 2026-10-02): harmless by data, not by construction. Remove the hold when ENG-022 makes the route answer 401 through requireCronSecret.',
        probe: { path: '/api/cron/auto-release', body: undefined, anon: [401], hold: 'the job runs for ANY caller in development mode (route.js:14) and moves money: held until ENG-022 adds requireCronSecret' },
    },
    {
        route: '/api/cron/notifications', method: 'GET', today: 'partial', kind: 'self', self: 'CRON_SECRET, made fail-closed', owner: '-',
        note: 'MEDIUM: fail-open, no check at all when CRON_SECRET is unset or empty (14); anonymous caller ca… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 500 \'Internal Server Error\'. The route did not refuse the anonymous caller (the answer is not 401). Known failure: ENG-022 makes it 401 through requireCronSecret, which also refuses with 401 when CRON_SECRET is unset, as it is on the dev app. Probe (B2, 2026-10-02): hold. With CRON_SECRET unset the check at notifications/route.js:14 is skipped, so one request, from any credential or none, runs the job: it selects the providers with stripe_onboarding_complete = 0 (:26-31) and for each sends an email (:46) and a push (:52) and updates onboarding_reminder_stage (:54-57). Today it stops only because that column is not in the dev schema (absent at 07:04 on 2026-10-02), so the SELECT throws and the answer is 500: an accident, not a guard. Remove the hold when ENG-022 makes the route answer 401 through requireCronSecret.',
        probe: { path: '/api/cron/notifications', body: undefined, anon: [401], hold: 'the job runs for ANY caller while CRON_SECRET is unset (route.js:14): held until ENG-022 adds requireCronSecret' },
    },
    {
        route: '/api/customer/booking-details', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller (today enforced, role not)',
        note: 'LOW: ownership enforced, role is not; a provider or admin JWT whose id equals a customer\'s user…',
        probe: { path: '/api/customer/booking-details', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/bookings', method: 'GET', today: 'none', kind: 'roles', roles: ['customer', 'admin'], owner: 'bookings.user_id = caller; a `?user_id=`/`?email=` naming anyone else: 403',
        note: 'HIGH: anyone reads any customer\'s bookings by sequential ?user_id= or by ?email=: b.* incl. add…',
        probe: { path: '/api/customer/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/bookings', method: 'POST', today: 'none', kind: 'roles', roles: ['customer', 'admin'], owner: 'booking_id must belong to caller (`AND b.user_id = caller`)',
        note: 'HIGH: the verification is a user_id or email the caller supplies; sequential booking_id plus gu…',
        probe: { path: '/api/customer/bookings', body: {}, anon: 401 },
    },
    {
        route: '/api/customer/bookings/[id]/approve', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller (today enforced, role not)',
        note: 'MEDIUM: moves money; role unchecked, a provider JWT whose id equals the customer\'s users.id pas…',
        probe: { path: '/api/customer/bookings/999999999/approve', body: {}, anon: 401 },
    },
    {
        route: '/api/customer/bookings/[id]/cancel', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller (today enforced, role not)',
        note: 'LOW: ownership enforced, role is not; a provider JWT whose id collides with a customer\'s users.…',
        probe: { path: '/api/customer/bookings/999999999/cancel', body: {}, anon: 401 },
    },
    {
        route: '/api/customer/invoices', method: 'GET', today: 'none', kind: 'roles', roles: ['customer'], owner: 'bookings.user_id = caller; a `?user_id=`/`?email=` naming anyone else: 403',
        note: 'HIGH: ?user_id=null passes the guard (10) but adds no WHERE filter (28-34), returning every cus…',
        probe: { path: '/api/customer/invoices', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/reviews', method: 'GET', today: 'none', kind: 'roles', roles: ['customer'], owner: 'own booking; customer_id from caller',
        note: 'LOW: with sequential booking_id and customer_id anyone reads review text, rating and invoice st…',
        probe: { path: '/api/customer/reviews', body: undefined, anon: 401 },
    },
    {
        route: '/api/customer/reviews', method: 'POST', today: 'none', kind: 'roles', roles: ['customer'], owner: 'own booking; customer_id from caller',
        note: 'HIGH: anonymous review on any paid booking, attributed to any customer_id and counted against A…',
        probe: { path: '/api/customer/reviews', body: {}, anon: 401 },
    },
    {
        route: '/api/customers', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL: anonymous delete of any users row (admins included) and all their bookings by user_id…',
        probe: { path: '/api/customers', body: undefined, anon: 401 },
    },
    {
        route: '/api/customers', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL: with no param it returns EVERY user incl. admin accounts (email, phone, role); ?email…',
        probe: { path: '/api/customers', body: undefined, anon: 401 },
    },
    {
        route: '/api/customers', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL: anonymous caller can create a users row with role \'admin\' (86), then log in through /…',
        probe: { path: '/api/customers', body: {}, anon: 401 },
    },
    {
        route: '/api/customers', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'CRITICAL: anonymous password reset of ANY account (customer, provider or admin) by numeric id: …',
        probe: { path: '/api/customers', body: {}, anon: 401 },
    },
    {
        route: '/api/customers/[id]', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer', 'admin'], owner: 'users.id = caller',
        note: 'Role not checked: mobile/Google provider tokens carry id, so provider N passes as customer N; a… Probe (B2, 2026-10-02; QA F7): allowed [403, 404]. An ownership row: the probe id is nobody own, so the ALLOWED customer is refused 403 by the handler own ownership check (customers/[id]/route.js:151-153) and the allowed admin gets 404 (no user 999999999, :193-195). Either status is legitimate for an allowed role; a 401 is not. Today the admin cookie answers 401, because the handler reads only the customer_token cookie (:140), and that stays wrong.',
        probe: { path: '/api/customers/999999999', body: undefined, anon: 401, allowed: [403, 404] },
    },
    {
        route: '/api/customers/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'users.id = caller',
        note: 'Upload extension comes from client filename, no type/size check, written to public/uploads (L28… Probe (B2, 2026-10-02; QA F7): allowed [400, 403, 404]. An ownership row: the probe id is nobody own, so the ALLOWED customer is refused 403 by the ownership check (customers/[id]/route.js:249-251), which runs before the body is read (:253-271), the file write (:279-295) and the UPDATE (:315). A conversion that answers 404 for a missing user, or validates first and answers 400 (first_name and last_name are required, :273-275), is as legitimate; a 401 is not. No credential reaches a write with {}.',
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
        route: '/api/mobile/push-token', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer', 'provider'], owner: 'body userId must equal caller',
        note: 'Auth is log-only (L22-24), identity from body: anyone can overwrite any account\'s push token or…',
        probe: { path: '/api/mobile/push-token', body: {}, anon: 401 },
    },
    {
        route: '/api/payment/create-intent', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'own booking',
        note: 'Charge amount comes from client body service_price (L56-60), not re-read from services; error b…',
        probe: { path: '/api/payment/create-intent', body: {}, anon: 401 },
    },
    {
        route: '/api/provider', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Branches: ?id missing gives 400; ?id=N gives full cascade delete. Anyone on the internet can ir…',
        probe: { path: '/api/provider', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Branches: (a) ?id=X returns one provider incl. email and phone (L18-28); (b) ?status=S returns …',
        probe: { path: '/api/provider', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider', method: 'PUT', today: 'partial', kind: 'roles', roles: ['admin', 'provider'], owner: 'the no-`id` branch updates `caller.id` (today `decoded.id` from any role\'s Bearer, `provider/route.js:121-163`; read by me)',
        note: 'Target in Appendix A: admin (`?id=` branches), provider (no-`id` branch); a customer is refused. Census: Branches: (A) ?id=X with body exactly {status}: sets any provider to active/inactive/suspended/…',
        probe: { path: '/api/provider', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/availability', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own availability flag',
        note: 'Sound gate; no check on provider status, so suspended or deleted providers with a live token st…',
        probe: { path: '/api/provider/availability', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/availability', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own availability flag',
        note: 'Can run ALTER TABLE service_providers from the request path after an UPDATE error (L72-76); err… Probe (B2, 2026-10-02): body undefined. availability/route.js:62 reads the body (`await request.json()`) before the first side effect, the UPDATE at :66-69 and, after its error, the ALTER TABLE at :74-76, so a request with no body throws there and the catch at :93 answers 500: nothing is written and no schema is changed, for any credential. The old probe, {}, passed :62 and set the fixture provider offline (the is_available column exists on the dev schema, so the ALTER TABLE did not run).',
        probe: { path: '/api/provider/availability', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/availability', method: 'PUT', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own availability flag',
        note: 'Identical to POST via handleToggle (L42-44), including the ALTER TABLE fallback and the error.m… Probe (B2, 2026-10-02): body undefined, for the reason given on POST (handleToggle reads the body at availability/route.js:62, before the UPDATE at :66-69; the catch at :93 answers 500; nothing is written).',
        probe: { path: '/api/provider/availability', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned jobs plus the open pool',
        note: '?all=true removes the service-area filter (L128); postal_code unmasked (L198) while address_lin…',
        probe: { path: '/api/provider/available-jobs', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'claims open jobs',
        note: 'Any provider token can accept any open job: no approval, onboarding, status, area or availabili…',
        probe: { path: '/api/provider/available-jobs', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs/[id]', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job, or an open-pool job (provider_id IS NULL); never another provider\'s',
        note: 'IDOR: any provider reads full address, instructions and assigned provider_id of ANY booking id …',
        probe: { path: '/api/provider/available-jobs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/available-jobs/[id]', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job, or an open-pool job (provider_id IS NULL); never another provider\'s',
        note: 'No active/approved status check; customer-notify code reads job.user_id and customer_email neve…',
        probe: { path: '/api/provider/available-jobs/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/bookings', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned bookings',
        note: '?status= comma list is bound as parameters (L48-52), no injection; shows customer names for own…',
        probe: { path: '/api/provider/bookings', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/check-verification', method: 'GET', today: 'none', kind: 'public', public: 'pre-login verification status (enumeration noted, rate limits are a non-goal)', owner: '-',
        note: 'Account enumeration: 404 vs 200 reveals whether an email is a registered provider and whether i… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 400 \'Email is required\'.',
        probe: { path: '/api/provider/check-verification', body: undefined, anon: [400] },
    },
    {
        route: '/api/provider/dashboard-stats', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own stats',
        note: 'Sound gate and ownership; no provider status check.',
        probe: { path: '/api/provider/dashboard-stats', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/forgot-password', method: 'POST', today: 'none', kind: 'public', public: 'reset request', owner: '-',
        note: 'Enumeration via 404 vs 200; client-chosen source=mobile gives 6-digit Math.random OTP (L355-358… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email is required\'.',
        probe: { path: '/api/provider/forgot-password', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/jobs', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned jobs',
        note: 'Returns customer email and phone for every own job incl. completed and cancelled (L52-55); no s…',
        probe: { path: '/api/provider/jobs', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/[id]', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job, or an open-pool job; never another provider\'s',
        note: 'SELECT b.* (L31) returns the full booking row incl. customer contact and address for any unassi…',
        probe: { path: '/api/provider/jobs/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/photos', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'photos of own assigned jobs',
        note: 'Ownership verified before reading (L156-166); SELECT * returns all job_photos columns.',
        probe: { path: '/api/provider/jobs/photos', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/photos', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'photos on own assigned jobs',
        note: 'photo_url is any client string stored unvalidated (L31,85), may be an external URL; EXIF read o…',
        probe: { path: '/api/provider/jobs/photos', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/jobs/time-tracking', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own job timer',
        note: 'Sound ownership (L571); cookie-only, so Bearer mobile clients cannot call it.',
        probe: { path: '/api/provider/jobs/time-tracking', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/jobs/time-tracking', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own assigned job',
        note: 'Client-supplied submitted_duration_minutes and submitted_headcount (L185,191) set final_provide…',
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
        note: 'Bad or expired token yields 500 not 401 (still refused); logs the whole provider record (L65), …',
        probe: { path: '/api/provider/me', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/complete', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own onboarding',
        note: 'Reads docs and Stripe status (L39-48) but never enforces them; status IF(active, active, pendin… Probe (B2, 2026-10-02): holdAllowed. The handler never reads the body, so a request from an ALLOWED provider, whatever it carries, runs the UPDATE of onboarding_completed, onboarding_step and status at complete/route.js:54-63 and mails ADMIN_EMAIL, whose default is a real person address, at :83-90. The provider cookie and the provider Bearer are therefore not sent. None and every wrong role are sent: each stops at the 401 at :28-34 (no provider_token cookie, no providerId in a customer Bearer session) before any of it. Keep the hold until the converting ticket proves the allowed path another way (a fixture provider the handler may rewrite, or a stub of the mail send).',
        probe: { path: '/api/provider/onboarding/complete', body: {}, anon: 401, holdAllowed: 'an allowed provider request rewrites onboarding_completed, onboarding_step and status (complete/route.js:54-63) and mails ADMIN_EMAIL (:83-90) whatever the body' },
    },
    {
        route: '/api/provider/onboarding/create-stripe-account', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own payout account',
        note: 'Client refreshUrl and returnUrl are forwarded to Stripe as redirect targets (L40-45); error bod… Probe (B2, 2026-10-02): body undefined. create-stripe-account/route.js:36 reads the body (`await request.json()`) before the first database read (:48) and before every Stripe call (:70, :73, :92), so a request with no body throws there and the catch at :148 answers 500: no outbound call, no write. The old probe, {}, passed :36 and reached stripe.accounts.create at :92.',
        probe: { path: '/api/provider/onboarding/create-stripe-account', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/documents', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own KYC documents',
        note: 'Returns admin_notes (internal reviewer notes, L33) and ID or insurance document_url to the prov…',
        probe: { path: '/api/provider/onboarding/documents', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/profile', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'Only bio is validated (L34-43); other fields unvalidated; resets onboarding_step to 2 even for …',
        probe: { path: '/api/provider/onboarding/profile', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/stripe-complete', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own payout account',
        note: 'Client body accountId (L39) is stored as payout account and can mark onboarding complete from a… Probe (B2, 2026-10-02): body undefined. stripe-complete/route.js:38 reads the body (`await request.json()`) before the first database read (:43), the Stripe call (:63) and the UPDATE at :107, so a request with no body throws there and the catch at :145 answers 500: nothing is read, called or written. The old probe, {}, reached :43 and stopped at the 400 at :50-56 only because no provider has a bank-account row (provider_bank_accounts had 0 rows on the dev DB at 07:04 on 2026-10-02): harmless by data, not by construction.',
        probe: { path: '/api/provider/onboarding/stripe-complete', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/stripe-return', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own Stripe onboarding return',
        note: 'State-changing GET: cross-site navigation carries the SameSite=Lax cookie and forces onboarding…',
        probe: { path: '/api/provider/onboarding/stripe-return', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/update-step', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own onboarding_step',
        note: 'step taken from body, any value or type, unvalidated (L31-47). Bearer branch also accepts email…',
        probe: { path: '/api/provider/onboarding/update-step', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/onboarding/upload-document', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own onboarding documents',
        note: 'Path built L116-119: path.join(public/uploads/providers, `${providerId}-${documentType}-${Date.…',
        probe: { path: '/api/provider/onboarding/upload-document', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/payouts', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own earnings and payouts',
        note: 'Cookie only (mobile Bearer not supported); no suspended/deleted-status check on a 7-day token; …',
        probe: { path: '/api/provider/payouts', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/profile', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'Cookie only; no password hash selected; L1-130 is a commented-out older copy of the file (dead …',
        probe: { path: '/api/provider/profile', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/profile', method: 'PUT', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own profile',
        note: 'Explicit column allowlist (status not writable), but email and phone change with no re-verifica…',
        probe: { path: '/api/provider/profile', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/ratings', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own reviews',
        note: 'Cookie only; shows reviewer first and last name unless is_anonymous (L185); L1-111 is a comment…',
        probe: { path: '/api/provider/ratings', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/reset-password', method: 'POST', today: 'partial', kind: 'public', public: 'reset completion; guard is the token/OTP (see S1)', owner: '-',
        note: 'Token path needs no email and the 6-digit mobile OTP lives in the same reset_token column, so a… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Password required\'.',
        probe: { path: '/api/provider/reset-password', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/signup', method: 'POST', today: 'none', kind: 'public', public: 'provider signup', owner: '-',
        note: 'No rate limit or captcha; reveals registered emails and phones (L205, L218, L231); OTP from Mat… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'All fields are required\'.',
        probe: { path: '/api/provider/signup', body: {}, anon: [400] },
    },
    {
        route: '/api/provider/status', method: 'GET', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own status',
        note: 'Bearer branch also accepts email_verification/password_reset JWTs (carry providerId) with no ac…',
        probe: { path: '/api/provider/status', body: undefined, anon: 401 },
    },
    {
        route: '/api/provider/upload', method: 'POST', today: 'full', kind: 'roles', roles: ['provider'], owner: 'own documents and avatar',
        note: 'Path built L150-160: path.join(public/uploads, `${providerId}-${documentType}-${Date.now()}${pa…',
        probe: { path: '/api/provider/upload', body: {}, anon: 401 },
    },
    {
        route: '/api/provider/validate-reset-token', method: 'GET', today: 'none', kind: 'public', public: 'reset page link check (see S1)', owner: '-',
        note: 'Unauthenticated oracle for live reset_token values including 6-digit mobile OTPs, no email need… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 400 \'Token required\'.',
        probe: { path: '/api/provider/validate-reset-token', body: undefined, anon: [400] },
    },
    {
        route: '/api/provider/verify-email', method: 'GET', today: 'full', kind: 'public', public: 'emailed verification link (signed token)', owner: '-',
        note: 'State-changing GET. JWT branch selects WHERE email=? OR id=? (L29-34), so a stale token can hit… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 400 \'No verification token provided\'.',
        probe: { path: '/api/provider/verify-email', body: undefined, anon: [400] },
    },
    {
        route: '/api/provider/verify-otp', method: 'POST', today: 'partial', kind: 'public', public: 'OTP check (see S1)', owner: '-',
        note: '6-digit OTP, no rate limit or lockout, not consumed (so it also opens reset-password); expiry N… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and an empty JSON body: 400 \'Email and verification code required\'.',
        probe: { path: '/api/provider/verify-otp', body: {}, anon: [400] },
    },
    {
        route: '/api/reviews', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Unauthenticated delete of any review by sequential id; provider ratings are recomputed afterwar…',
        probe: { path: '/api/reviews', body: undefined, anon: 401 },
    },
    {
        route: '/api/reviews', method: 'GET', today: 'none', kind: 'roles', roles: ['customer', 'admin'], owner: 'customer: reviews of own bookings',
        note: 'No filter returns every review with customer name and customer_email (L112-113) even when is_an…',
        probe: { path: '/api/reviews', body: undefined, anon: 401 },
    },
    {
        route: '/api/reviews', method: 'POST', today: 'none', kind: 'roles', roles: ['customer'], owner: 'own completed booking; customer_id from caller',
        note: 'Anyone can post a review as any customer for any completed booking, attach it to any provider_i…',
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
        note: 'Unauthenticated delete of any service-location page by id; 500 echoes error.message (L208).',
        probe: { path: '/api/service-locations', body: undefined, anon: 401 },
    },
    {
        route: '/api/service-locations', method: 'GET', today: 'none', kind: 'public', public: 'landing pages; `?admin=`/`?includeInactive=` branches require admin', owner: '-',
        note: '?includeInactive=true or ?admin=true (L13) drops the is_active filter with no auth (draft rows)… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/service-locations', body: undefined, anon: [200] },
    },
    {
        route: '/api/service-locations', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Unauthenticated write of public page content (canonical_url, intro, description) that feeds /ap…',
        probe: { path: '/api/service-locations', body: {}, anon: 401 },
    },
    {
        route: '/api/services', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Unauthenticated delete of any service; image_url is client-set via POST/PUT, so the unlink can …',
        probe: { path: '/api/services', body: undefined, anon: 401 },
    },
    {
        route: '/api/services', method: 'GET', today: 'none', kind: 'public', public: 'catalogue; the `?admin=true` branch requires admin', owner: '-',
        note: '?admin=true (L17, L59) turns off the is_active filter with no auth and exposes all s.* columns;… Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/services', body: undefined, anon: [200] },
    },
    {
        route: '/api/services', method: 'POST', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Unauthenticated creation of services with attacker-chosen price, slug, image_url and skills; au…',
        probe: { path: '/api/services', body: {}, anon: 401 },
    },
    {
        route: '/api/services', method: 'PUT', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Unauthenticated price, name, slug or active-flag change on any service (price source for bookin…',
        probe: { path: '/api/services', body: {}, anon: 401 },
    },
    {
        route: '/api/skills', method: 'GET', today: 'none', kind: 'public', public: 'public catalogue', owner: '-',
        note: 'Read-only catalogue; nothing sensitive. Probe measured on the dev app at 04:50 on 2026-10-02 with no credential and no body: 200.',
        probe: { path: '/api/skills', body: undefined, anon: [200] },
    },
    {
        route: '/api/stats', method: 'GET', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Anyone can read platform-wide business metrics: totalRevenue (L44, L103), bookings by status, c…',
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
        note: 'Test endpoint left live: anyone can push arbitrary title and body to any user or provider id, o…',
        probe: { path: '/api/test/push', body: {}, anon: 401 },
    },
    {
        route: '/api/upload', method: 'DELETE', today: 'none', kind: 'roles', roles: ['admin'], owner: '-',
        note: 'Unauthenticated delete of any file in public/uploads by name, including provider documents and …',
        probe: { path: '/api/upload', body: undefined, anon: 401 },
    },
    {
        route: '/api/upload', method: 'POST', today: 'none', kind: 'roles', roles: ['customer', 'provider', 'admin'], owner: '-',
        note: 'Path built L42-45: path.join(public/uploads, `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/…',
        probe: { path: '/api/upload', body: {}, anon: 401 },
    },
    {
        route: '/api/user/addresses', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'Any valid JWT accepted: provider and admin mobile tokens carry id = their own table id (auth/mo…',
        probe: { path: '/api/user/addresses', body: undefined, anon: 401 },
    },
    {
        route: '/api/user/addresses', method: 'POST', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'Same flaw: provider or admin token id used as users.id, so a provider writes addresses into the…',
        probe: { path: '/api/user/addresses', body: {}, anon: 401 },
    },
    {
        route: '/api/user/addresses/[id]', method: 'DELETE', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'Same id-namespace flaw: a provider or admin token with the matching numeric id can delete that …',
        probe: { path: '/api/user/addresses/999999999', body: undefined, anon: 401 },
    },
    {
        route: '/api/user/addresses/[id]', method: 'PUT', today: 'partial', kind: 'roles', roles: ['customer'], owner: 'user_id = caller',
        note: 'Same id-namespace flaw; SET list built from fixed column names only (L37-42), so no injection.',
        probe: { path: '/api/user/addresses/999999999', body: {}, anon: 401 },
    },
    {
        route: '/api/user/settings', method: 'GET', today: 'partial', kind: 'roles', roles: ['customer', 'provider'], owner: 'own row',
        note: 'Admin or other-role token falls through to users by decoded.id (low impact); web provider token…',
        probe: { path: '/api/user/settings', body: undefined, anon: 401 },
    },
    {
        route: '/api/user/settings', method: 'PUT', today: 'partial', kind: 'roles', roles: ['customer', 'provider'], owner: 'own row',
        note: 'Same: admin or other-role token writes the users row with the same numeric id (low impact); onl…',
        probe: { path: '/api/user/settings', body: {}, anon: 401 },
    },
];
