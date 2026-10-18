# WorkOnTap Phase 1: handoff

This note says what Phase 1 covers, how each promise in the contract was checked, what could only be attempted in the development environment, and what you need to supply before the system can run for customers. It describes one commit: **e529a5d 2026-10-17**. Any later change to the code makes the table in section 3 out of date; run the suite again (section 2) to refresh it.

Nothing described here ran against production. Production is not part of this build.

## 1. What this is

Phase 1 is the quote-to-job core of the platform:

- A customer books online, one time or on a schedule, at the price the pricing rules produce. The card is held when the booking is made, and is charged once, only after the visit is done.
- A job that cannot be priced becomes a quote request. An admin sees every job, books on a customer's behalf (the customer is sent the quote and a link to add a card), and assigns a job or offers it to the marketplace.
- A provider keeps a crew list and puts cleaners on a job. Each cleaner is texted a link to the job.
- A cleaner enters the code that was texted to them and checks in everyone who showed up. Before photos are taken, and the job is started from the link, inside the check-in window and with the location recorded. A countdown shares the quoted time among the cleaners who are checked in.
- On-site reports reach the admin queue, and extra items are charged only after an admin approves them.
- The code sends the texts and e-mails the contract lists (section 4 says what could and could not be checked here), and the nine defects the contract names were fixed.

The contract lists twelve things by which "we'll know it worked", W1 to W12. Five of them are hard gates: W2, W5, W9, W11 and W12. W11 is the nine named defects, D1 to D9. The automated suite checks them: 1,994 cases in 72 files under `e2e/`. A map in `e2e/acceptance/contract.js` says which cases prove which sentence of the contract, and `npm run acceptance` reads a run of the suite against that map and says, for each item, whether the suite shows it.

Section 3 is what the suite shows. Section 4 is what is known only from what the code tries to do. Section 5 is what you supply. Section 6 is what is not built. Section 7 is where the evidence has gaps and the decisions asked of you.

## 2. Bring up the dev environment and run the suite

The development environment is two containers: an app container that runs the Next.js development server on port 3000 against the checkout, and a MySQL 8.4 container (host port 3307, database `workontap_db`) that holds the 33 tables of the live schema and no data. The compose file and the development Dockerfile that build them are not committed to the repository. The app must reach the database under the host name `db` or `localhost`, and the database must be called `workontap_db`: the fixture command, which empties every table, refuses any other target and any database that holds an e-mail address outside the reserved test names (`.test`, `.example`, `.invalid`, `.localhost`, `example.com`, `example.net` and `example.org`), and nothing turns that off. The suite only ever sees synthetic rows.

In order:

1. Start the stack with the checkout mounted into the app container. The app needs `JWT_SECRET` in its environment (for the development server, in `.env.development.local`); without it every sign-in answers 500.
2. Load the synthetic data, before a run and after it (any run writes one activity-log row through its pre-flight sign-in):

   ```
   docker exec workontap-app npm run db:fixtures
   ```

3. Run the suite, then read the run against the contract:

   ```
   npm test
   npm run acceptance
   ```

   `npm test` is Playwright 1.58.2. On a machine with no browser build for that version, run the same command inside the published Playwright 1.58.2 image with the checkout mounted and the host network, so that the suite reaches the app at `http://localhost:3000` (`E2E_BASE_URL` changes the address).

If the stack or the fixtures are missing, the suite stops at the start and prints one of these two lines:

- `app not reachable at <url> after <n> s (last: <problem>)`
- `fixtures not loaded in the database the app reads (fixture sign-in answered <status>); run the fixture command: npm run db:fixtures`

`npm test -- e2e/<file>.spec.js` runs one file; a full run is long (about two and a quarter hours of test time on the build host, counting the windows that had to be repeated), so it is easiest to run it in windows of a few files and to give the acceptance command the union: merge the `cases` of each window's `test-results/baseline-candidate.json` into one file of the same shape and pass it with `--results`. `npm run acceptance -- --markdown --label "<commit> <date>"` prints the tables in section 3. It exits 1 when a hard-gate item is not shown, or departs from the contract with no acceptance written into the map. The README has the rest (the fixture rules, the baseline file, the `ATTEMPTED` outcome).

## 3. The twelve items

How to read the table. An item is the clauses of the contract's own sentence, and takes the status of its worst clause. The five count columns count clauses.

- **MET** (Live): requests to the running app and its database, or a real browser, show it.
- **MET (in-process)** (With a stand-in): the code that does it was run directly in the test, with a stand-in for the outside service (the card service), because the development environment has no account with it.
- **ATTEMPT-ONLY** (Attempt only): the code was seen to try, and nothing was delivered. Section 4.
- **DEPARTS** (Departs): the build does something different from the contract's words. The difference is written in the map and waits for a decision (section 7). A hard-gate item that departs and has not been accepted in writing makes the acceptance command exit 1.
- **NOT MET** or **NOT RUN** (Not met): a case failed, was skipped, was renamed or deleted, or has no result. A hard-gate item in this state is a failure, always.

Gate table for e529a5d 2026-10-17, read from 1994 cases.

| Item | Hard gate | Status | Live | With a stand-in | Attempt only | Departs | Not met | The contract says |
|---|---|---|---|---|---|---|---|---|
| W1 |  | ATTEMPT-ONLY | 5 | 0 | 1 | 0 | 0 | A customer can complete the full four-step flow on the website with a live price at every step, book one-time or recurring, and have their card held, not charged. Each recurring visit appears in the admin queue as its own job. A job that can't be priced routes to a quote request that reaches the admin queue. |
| W2 | yes | MET (in-process) | 2 | 2 | 0 | 0 | 0 | The price charged is always the one WorkOnTap's pricing rules produce, including for a booking made on a customer's behalf, and the card is charged only once each visit is done. |
| W3 |  | ATTEMPT-ONLY | 1 | 1 | 1 | 0 | 0 | An admin can book a job on a customer's behalf through the website flow; the booking appears in the admin portal, and the customer receives the quote by email and SMS with a working link to add their card on file. |
| W4 |  | ATTEMPT-ONLY | 2 | 0 | 1 | 0 | 0 | A provider can add cleaners to their crew list and assign them to a job, and each assigned cleaner receives the job link by text. |
| W5 | yes | DEPARTS | 8 | 0 | 0 | 1 | 0 | A job can only be started from its link by an assigned cleaner who has entered the code sent to their phone, the provider, or a WorkOnTap admin, within the check-in window, after before photos are taken, with the location recorded. |
| W6 |  | MET | 3 | 0 | 0 | 0 | 0 | One person can check in every assigned cleaner who showed up, and add a late arrival later. |
| W7 |  | MET (in-process) | 3 | 1 | 0 | 0 | 0 | The timer counts down the job's quoted hours divided by the cleaners checked in, re-divides when a cleaner is added or checked out, and shows the assigned crew and who is checked in. |
| W8 |  | ATTEMPT-ONLY | 3 | 1 | 1 | 0 | 0 | Each of the five on-site reports reaches the admin queue and alerts admin and the provider; added items are charged only after admin approval. |
| W9 | yes | MET | 5 | 0 | 0 | 0 | 0 | Every booked job appears in the admin queue; admin can assign it directly or push it to the marketplace, and once a job is claimed, no second provider can also claim it. |
| W10 |  | ATTEMPT-ONLY | 0 | 0 | 7 | 0 | 0 | The right transactional SMS and email fires for every quote requested, quote and card link sent, job booked, assigned and claimed, job link sent, and on-site report. |
| W11 | yes | MET (in-process) | 5 | 4 | 0 | 0 | 0 | Every one of the nine defects above is re-tested and closed. |
| W12 | yes | MET (in-process) | 5 | 2 | 0 | 0 | 0 | No customer, provider, cleaner, or stranger can reach another account's data or actions they're not authorized for. |

| Defect | Status | The contract says |
|---|---|---|
| D1 | MET | Anyone on the internet, no login needed, can list, change, or delete bookings, including their status, assigned provider, and payment status. |
| D2 | MET | Admin finance data (payouts, earnings, invoices, provider details, activity logs) can be reached without an admin login. |
| D3 | MET | Any customer's bookings can be looked up by their email address, without logging in. |
| D4 | MET (in-process) | The price a customer is charged comes from their own device and can be changed before payment. |
| D5 | MET (in-process) | When a job is marked finished, the provider can enter any number of hours and crew size, and both the customer's bill and the payout follow that number. |
| D6 | MET | File uploads are accepted from anyone, without a login. |
| D7 | MET (in-process) | The key that secures every login falls back to a publicly known default if it is not configured. |
| D8 | MET (in-process) | Text a provider types into a job summary is placed into the customer's email unchecked. |
| D9 | MET | The provider-signup page on the live site never finishes loading. |

Where the build departs from the contract:

* W5.one-door: The provider's own page can also start a confirmed job that has a before photo, with no check-in and no location recorded, through a second route (time-tracking). It does not go through the job link, the check-in window or the position. The contract says: A job can only be started from its link, within the check-in window, with the location recorded. (not yet accepted or closed.)

Cases the dev environment cannot run, skipped by name:

* W12.customer-and-stranger: there is no address row to ask for another customer's address
* W12.customer-and-stranger: the dev database has no user_addresses table, so the owner's read of an address cannot be observed

Of the twelve items, two are met live (W6, W9), four are met in process (W2, W7, W11, W12), five are attempt-only (W1, W3, W4, W8, W10) and one departs from the contract (W5). Four of the five hard-gate items are met (W2, W9, W11, W12); W5 is the fifth and it departs, so `npm run acceptance` exits 1 until the decision in section 7 is made. All nine defects are closed, five live (D1, D2, D3, D6, D9) and four in process (D4, D5, D7, D8); of the 1,994 cases, 1,961 passed, 31 ended `ATTEMPTED` and 2 were skipped by name, and none reads red in this table.

**W5: the one departure.** The contract says a job can only be started from its link, by an assigned cleaner who has entered the code, the provider, or an admin, inside the check-in window, after before photos are taken, with the location recorded. The job link does all of that, and every refusal is its own case. The provider's own page also has a "Start Job" button, which starts a confirmed job that has a before photo through a second route (`/api/provider/jobs/time-tracking`, action `start`) with no cleaner checked in, outside the check-in window and with no position recorded. The suite pins this as it stands (`job-timer.spec.js`, case AC2, marked "hard gate", and `acceptance-links.spec.js`, "W5.one-door"), and the map reads it as a departure. Section 7 says what is asked.

## 4. Verified only by what the code attempts

Some promises end at a service the development environment has no account with: Twilio (texts), an SMTP server (e-mail) and Stripe (the card). For these the suite shows that the code decides to send, to the right people, once, and that it records the attempt. It cannot show that the service delivers. Those cases report `ATTEMPTED (missing: ...)`, never `PASS`, and the acceptance command prints the clause as ATTEMPT-ONLY. It is never counted as met.

**Texts and e-mails** (W3: the quote and card link; W4: the job link; W8: the alerts for an on-site report; W10: each of the seven kinds, which are a quote requested, a quote and card link sent, a job booked, a job assigned or reassigned, a job claimed, a job link sent, and an on-site report). Every notice claims a row in `notice_attempts` before anything is sent: one row for one person, one message and one channel, holding the kind, the channel, who it was for, the booking and how it ended. The row holds no number, address, name or message text. With no Twilio or SMTP credential the row ends `not_configured` and nothing leaves the machine. The cases read those rows: who was told, on which channel, how many times (once), and that nobody else was. The cases are in `notices-routes.spec.js` (the route that raises each notice), `notices-events.spec.js` (who is told for each event), `acceptance-seams.spec.js` (job booked; the alerts for each kind of report) and `acceptance-journey.spec.js` (the link texted to two cleaners and to a late third; the alerts for an added-items report). The code also texts the customer when a job is started or finished from the provider's page, two notices the contract does not list; they go through the same machinery and are attempts only in the same way.

**The card held, not charged** (W1). With no Stripe secret key, a booking made outside production is recorded as `pending`, never as `authorized`, and the completion cannot charge it (`booking-payment.spec.js`, "a booking made where no payment key is set is recorded as pending with no held amount"). The case that asks the payment-intent route for a hold (`harness.spec.js`) ends `ATTEMPTED`: with no key the route cannot start a payment and answers 500. What the suite does not show is Stripe accepting the hold.

**What would turn them into passes.** The three Twilio variables for the texts, an SMTP account for the e-mail, and a Stripe test-mode secret key and publishable key for the hold (section 5 names them). The suite has not been run in that state, so run it with test credentials before relying on it, and watch the first real sends of each kind in `notice_attempts`.

## 5. What you must supply before production

- **Stripe.** A live secret key (`STRIPE_SECRET_KEY`), the publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) and the signing secret for the payout events (`STRIPE_WEBHOOK_SECRET`, read by `/api/stripe/webhook`), and test-mode keys for a staging site. `STRIPE_COUNTRY` and `STRIPE_CURRENCY` are `CA` and `cad` in the example file. **Without a secret key a production deploy refuses every booking** with a 503 ("Payments are not available right now. Please try again shortly.") and writes nothing; that is intended. Outside production a booking is recorded as `pending` and never charged. The card-saving terms and the consent text on the card page are yours and your lawyer's: the build supplies none.
- **Twilio.** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_PHONE_NUMBER`, a number approved to text Canadian numbers, and a spend limit or usage alert in the Twilio account itself (no code replaces it). The code bounds what it spends: 8 texts a day to one number (2 for a quote request), 200 a day for one provider and 500 a day for the platform. A text goes only to a Canadian number (+1 with a Canadian area code). A cleaner is sent a job link only after the cleaner's number has passed a check: a six-digit code is texted to it and the provider enters the code the cleaner reads back. So the check needs Twilio too, and until it works no cleaner can be sent a link. `NEXT_PUBLIC_APP_URL` must be the real `https:` address of the site: with anything else a link text is refused (`no_origin`). Make the first real sends one booking of your own.
- **E-mail.** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM`, and `ADMIN_EMAIL`. Admins who are told are every admin user plus `ADMIN_EMAIL`, once each.
- **Secrets.** `JWT_SECRET` has no built-in value: with it unset every sign-in answers 500, every session is refused and the mobile app is signed out when it next refreshes. Changing it ends every web session. `CRON_SECRET` is needed by the three scheduled jobs in `vercel.json` (the hourly sweep that approves a finished job its customer has left for 24 hours and takes the payment, and the daily clean-ups of crew data and of job photos); they refuse to run without it. The example file `.env.example` lists the names for the database, sessions, Twilio and e-mail; it does not list the Stripe keys or `CRON_SECRET`, which the code reads.
- **Where photos live.** A production store for photos is **not chosen**. The host (Vercel) has no persistent disk, so photo capture works only where there is a disk, as does every upload in the app. The choices are an object-storage vendor (a recurring cost and a credential) or the database. If the store is on another origin, the site's content security policy must name it in `img-src`. A photo's address is its only protection (a random 128-bit name, publicly readable, cached for a year). Photos taken from a job link are kept 365 days by the daily clean-up; photos taken on the provider's page are kept for ever; nothing deletes a single photo on request (section 6).
- **Hosting.** Texts and e-mails are sent after the response is returned, so the host must keep the process alive until they finish. The job link page and the card link page, whose addresses are credentials, run none of the site-wide scripts (including those pasted into the SEO settings); make sure nothing at the host or a proxy adds a script to `/job/*` or `/card/*`. Do this before the first link is texted. Confirm that the application server and the database agree on the time zone.
- **The database.** The changes are plain SQL in `database/migrations/`, applied by hand, in this order: `0001` service pricing items, `0002` payment intent unique, `0003` marketplace pushed at, `0004` visit series, `0005` quote requests, `0006` booking card links, `0007` provider crew, `0008` job links, `0009` job photos and timer, `0010` job reports, `0011` notice attempts. Each has a `.down.sql`; `database/schema.js` carries the same for a fresh install. Before `0002`, run the query in its header: if it returns rows, stop (two bookings share a payment). `0008` down discards every link, code and check-in; `0009` down loses who took each photo. Deploy the code after the migrations, with the Stripe key set, and then enter the pricing rule table's figures.
- **One question.** Does the table `user_addresses` exist in production? The address routes answer 500 without it. The development database does not have it, and it is not created here (section 7).

## 6. What is deliberately not built

The contract's own out-of-scope list: extension approvals, contractor staff logins, mobile app changes, a live dashboard, refund and dispute flows, double-charge protection, new revenue features.

Knowingly left, in plain words:

- A production store for photos (section 5); a control for an admin to delete one job photo, and a way for a customer to ask for one to be deleted.
- A way to correct a check-in made by mistake; a rule for how long a cleaner's name and number are kept once they leave a crew; hardening of the link's check-out and the timer.
- For a customer with no account: a page to approve or dispute an added-items charge before it is made. Notices the contract does not list: a text to the customer when an added-items charge is made or declined, a text to the customer when a cleaner starts the job from the link, and an alert to the admin when a job goes over its quote.
- Older code, outside this work: the older HTML e-mail templates put a hard-coded personal address where `ADMIN_EMAIL` should be and do not escape every value; a provider who is not active can still use provider routes that do not read their own row; the public checkout writes the customer's contact to the application log.
- Small edges in the notices, the link pages and the card links. On the quote form: nothing warns anyone when its daily share of quote texts or e-mails is used up (the `notice_attempts` table shows it, as outcomes `kind_cap` and `mail_cap`); one mailbox written as many aliases (`name+1@`, `name+2@`) draws up to 100 quote e-mails a day and uses up the day's confirmations for real customers, whose requests are still saved, which needs a product decision (a confirmation before the first e-mail, or a CAPTCHA); and an address with a label and a colon in front of it (`label:mailbox@host`) is accepted and slips past the per-address limit, where it should simply be refused.

## 7. Known gaps in the evidence

- **The provider's "Start Job" button (W5).** Decision asked of you, in one sentence: close the second door (change the provider's page to open the job link, where the provider may start the job, and make the time-tracking route refuse a start), or accept it in writing by filling in `accepted` on `W5.one-door` in `e2e/acceptance/contract.js`. Until one of those is done, `npm run acceptance` exits 1 on W5.
- **Texts, e-mails and the card hold** are attempt-only (section 4). The journey case that follows one booking from checkout to a finished job (`acceptance-journey.spec.js`, eleven steps) has its limits too: the texts and the alerts end `ATTEMPTED`; the booking's date is moved to yesterday by a database update so that the check-in window is open (the checkout books a future day); each cleaner's number is marked as checked by a database update, because the check itself needs a text; the code a cleaner was texted is found from its stored hash, because no text is ever read; and the approval of an added item is shown only as a refusal (503, nothing recorded) because the approval route needs a Stripe key. The charge after an approval is proved in process, with a stand-in for the card service, in `acceptance-seams.spec.js`.
- **Two cases skipped by name.** Two cases in `ownership.spec.js` (the owner's read of an address; another customer's address refused) cannot be observed because the development database has no `user_addresses` table. They are part of W12's ownership checks, and the map names them as gaps. See the question in section 5.
- **Two older findings, not fixed.** (a) `GET /api/provider/available-jobs/{id}` returns the street and the instructions of a job on the marketplace to a provider of any status (active, pending, inactive and suspended all got an answer), where the list of open jobs hides the street until the provider has the job. The cases that prove W12 pin that a provider cannot read another provider's assigned job; they do not pin what a provider, of any status, can read of an open job nobody has claimed. (b) `POST /api/provider/signup` is public and e-mails whatever address is typed, with the typed first name, and e-mails the admin on each signup; one signup per address is the only limit, so the form can be used to send mail to other people's addresses. Both were found by reading the code, and (a) was measured on the development environment; neither is one of the nine defects.
- **Two timing-sensitive cases.** Two cases in `job-timer.spec.js` compare the job's clock with a value worked out from the time that has passed, to a tolerance of a few seconds, across several requests: the countdown's wall-clock case ("AC3", 6 seconds) and the first "AC4" case (an hour on, a fourth cleaner checks in and the next read must be 2700; a check-out must then read 5400; 15 and 10 seconds). On a loaded machine, or on a development server that has not compiled a route yet, one request can take 2 to 17 seconds, and those seconds are counted too, so a right clock can read as a wrong one. "AC3" was seen to fail in a busy window and pass when run alone. The first "AC4" case failed in the first window that ran it (10820 seconds where 10800 were expected, tolerance 15), failed again alone in a window of its own while its routes were still cold (5381 where 5400 were expected, tolerance 10), and passed alone once those routes had been compiled; the extra seconds were the requests, not the clock, and the arithmetic itself is shown in process. In the complete run both read PASS: "AC3" from a run of five cases made on their own, and the first "AC4" case from its third run, made alone once its routes were compiled. If either is red in a later run, run it alone before reading it as a fault.
- **The label.** The table in section 3 describes the commit named at the top. The suite counts for that commit; this note, the README and the map's wording can change after it without invalidating it, and any change to `src/` or `e2e/` does.
- **How the complete run went.** It was made in windows of a few files each, on the commit named at the top, with the fixtures loaded fresh before and after every window; no file under `src/` or `e2e/` changed from the first window to the last, and none of the eleven journey steps was cut (eight pass and three end `ATTEMPTED`, as described above). Two things in it are worth knowing. (a) The app container's development server stopped by itself three times while windows were running, with a normal exit code and no message. A window that meets a stop writes a failure for every case after it, so from such a window only the cases that passed before its first failure were kept, the container was started again (`docker start workontap-app`), and the cases it lost were run again in a later window; nothing in the table comes from a case that ran against a stopped server. The cause was not found. If it happens in a run of yours, start the container again and run the lost cases again. (b) One case, "should redirect protected provider routes to /provider/login" in `provider.spec.js`, failed in its window: the server compiled the login page for the first time during the check, which its log puts at 10.9 seconds, and the check waits 5. It passed when run alone, and the table counts that run. A case that fails the first time a page is opened on a freshly started development server should be run once more alone before it is read as a fault.
