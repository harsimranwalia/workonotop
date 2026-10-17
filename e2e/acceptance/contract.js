// The contract's twelve "How we'll know it worked" items, split into the clauses of their own sentences, each naming the suite
// cases that would go red if that clause stopped being true. gate.js reads this and a run's results and says which clauses the
// run shows. Five items are [hard gate] in the contract: 2, 5, 9, 11 and 12.
//
// A pattern is tested against a case key, `<file> › <describe> › <title>`, so a renamed or deleted case matches nothing and its
// clause reads NOT MET. Cite the narrowest cases that would fail if the clause broke, never a case that passes whatever the
// server does (a scripted route, a screen's text, a source pin) as a clause's only proof.
//
// `kind` is the strongest proof the dev stack can give for the clause, and the gate holds the run to it:
//   live        real HTTP or a real browser against the running app; every case must PASS
//   in-process  the app's own module in the test process with a stand-in for Stripe, Twilio or SMTP; MET (in-process)
//   attempt     the app reaches its real send or charge path and ends in a notice_attempts row because the credential is not set
//               (ATTEMPTED); with the credential the same cases PASS and the clause reads MET, with no edit here
//   departure   the code does something other than the contract's words; a case pins what it does and the clause reads DEPARTS
//               until `accepted` is { by, on, ref }. The words flow into HANDOFF.md, so no ticket numbers and no seats.

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The cases of one spec file whose title starts with one of `titles`, under any describe. */
const spec = (file, ...titles) => new RegExp(`^${escape(file)} › (?:[^›]+ › )*(?:${titles.map(escape).join('|')})`);
/** Every case under one describe of a spec file. */
const group = (file, describe) => new RegExp(`^${escape(file)} › ${escape(describe)} › `);
/** Every case of a spec file. */
const wholeFile = (name) => new RegExp(`^${escape(name)} › `);

export const DEFECTS = [
    {
        n: 1,
        says: 'Anyone on the internet, no login needed, can list, change, or delete bookings, including their status, assigned provider, and payment status.',
        cases: [group('defects.spec.js', 'D1 bookings'), group('defects.spec.js', 'D1 owner of a booking made with a credential')],
    },
    {
        n: 2,
        says: 'Admin finance data (payouts, earnings, invoices, provider details, activity logs) can be reached without an admin login.',
        cases: [group('defects.spec.js', 'D2 admin finance data')],
    },
    {
        n: 3,
        says: "Any customer's bookings can be looked up by their email address, without logging in.",
        cases: [group('defects.spec.js', 'D3 customer lookup'), group('defects.spec.js', 'D3 owner reads their own booking')],
    },
    {
        n: 4,
        says: 'The price a customer is charged comes from their own device and can be changed before payment.',
        kind: 'in-process',
        cases: [
            spec('pricing-rules.spec.js', 'a figure in the request is not read'),
            spec('price-of-record.spec.js', 'a booking records the catalog price of the service it books', 'a booking records the catalog hourly rate'),
        ],
    },
    {
        n: 5,
        says: "When a job is marked finished, the provider can enter any number of hours and crew size, and both the customer's bill and the payout follow that number.",
        kind: 'in-process',
        cases: [
            spec('price-of-record.spec.js', 'the finish stores the payout as the booking', 'the finish stores the measured minutes', 'the invoice total is the booking'),
        ],
    },
    {
        n: 6,
        says: 'File uploads are accepted from anyone, without a login.',
        cases: [group('defects.spec.js', 'D6 uploads')],
    },
    {
        n: 7,
        says: 'The key that secures every login falls back to a publicly known default if it is not configured.',
        kind: 'in-process',
        cases: [spec('session-secret.spec.js', 'with JWT_SECRET unset or blank', 'the API guard answers 401 to a session cookie while JWT_SECRET is unset', 'a session signed with a key other than the configured JWT_SECRET')],
    },
    {
        n: 8,
        says: "Text a provider types into a job summary is placed into the customer's email unchecked.",
        kind: 'in-process',
        cases: [spec('job-completed-email.spec.js', "the job-completed e-mail shows the provider's summary", 'the job-completed e-mail shows names', 'the job-completed e-mail keeps unicode')],
    },
    {
        n: 9,
        says: 'The provider-signup page on the live site never finishes loading.',
        cases: [spec('provider-signup-page.spec.js', 'the provider sign-up page sends its form in the first response', 'the provider sign-up page shows its form while the session check has not answered')],
    },
];

/** One clause for each defect, so the nine are one item the way the contract has them. */
const defectClauses = DEFECTS.map((defect) => ({ id: `W11.D${defect.n}`, says: defect.says, kind: defect.kind, cases: defect.cases }));

export const ITEMS = [
    {
        n: 1,
        hard: false,
        says: "A customer can complete the full four-step flow on the website with a live price at every step, book one-time or recurring, and have their card held, not charged. Each recurring visit appears in the admin queue as its own job. A job that can't be priced routes to a quote request that reaches the admin queue.",
        clauses: [
            {
                id: 'W1.live-price',
                says: 'the four-step flow shows a live price at every step',
                cases: [spec('booking-guided-flow.spec.js', 'the price on every step equals the pricing rule', 'the steps of a service with a full rule', 'a service with units and an extra shows three steps', 'a Saturday as the first date', 'every price request carries the service')],
            },
            {
                id: 'W1.one-time-or-recurring',
                says: 'a booking is one-time or recurring',
                cases: [spec('booking-guided-flow.spec.js', 'a booking made with that body is a one-time job'), spec('recurring-visits.spec.js', 'a weekly booking saves twelve jobs a week apart')],
            },
            {
                id: 'W1.card-held',
                says: 'the card is held, not charged',
                kind: 'attempt',
                cases: [spec('harness.spec.js', 'POST /api/payment/create-intent as a customer'), spec('booking-payment.spec.js', 'a booking made where no payment key is set is recorded as pending')],
            },
            {
                id: 'W1.visit-is-a-job',
                says: 'each recurring visit appears in the admin queue as its own job',
                cases: [spec('recurring-visits.spec.js', 'each visit of a series is its own job in the admin queue')],
            },
            {
                id: 'W1.quote-request',
                says: "a job that can't be priced routes to a quote request",
                cases: [spec('quote-request.spec.js', 'a booking and create-intent refuse a job that needs a quote', 'a request for a quote is saved with the picks that sent it', 'a job that needs a quote shows no price and the form')],
            },
            {
                id: 'W1.quote-in-queue',
                says: 'the quote request reaches the admin queue',
                cases: [
                    spec('quote-request.spec.js', 'the admin reads the requests, newest first', 'the admin page lists the requests in "Quote requests"'),
                    spec('acceptance-seams.spec.js', 'Seams: W1 quote:'),
                ],
            },
        ],
    },
    {
        n: 2,
        hard: true,
        says: "The price charged is always the one WorkOnTap's pricing rules produce, including for a booking made on a customer's behalf, and the card is charged only once each visit is done.",
        clauses: [
            {
                id: 'W2.rule-price',
                says: "a booking records the price the pricing rule produces, and a figure in the request is not read",
                cases: [
                    spec('pricing-rules.spec.js', 'a booking records the price and the quoted minutes its answers produce', 'a figure in the request is not read'),
                    spec('price-of-record.spec.js', 'a booking records the catalog price of the service it books', 'a booking records the catalog hourly rate'),
                ],
            },
            {
                id: 'W2.on-behalf',
                says: "a booking made on a customer's behalf is priced by the rule, and a price in the body is ignored",
                cases: [
                    spec('on-behalf-booking.spec.js', 'an admin books for a customer who phoned in', 'a price, an account, a payment or a status in the body of an admin booking is ignored'),
                    spec('pricing-rules.spec.js', 'a booking an admin makes is priced by the rule from its answers'),
                ],
            },
            {
                id: 'W2.charged-when-done',
                says: "the card is charged only once each visit is done, once, for the recorded price",
                kind: 'in-process',
                cases: [
                    spec(
                        'booking-payment.spec.js',
                        "the customer's approval of a booking made on their behalf charges the card they saved once",
                        "the release sweep charges the card on file of a booking made on a customer's behalf once",
                        'a second release run takes nothing more for a booking already charged on its card',
                        'the release sweep marks a booking whose link holds no card as a failed payment',
                        "a booking made on a customer's behalf is neither charged nor failed before its date",
                    ),
                ],
            },
            {
                id: 'W2.charge-meets-record',
                says: "the amount charged is the price the booking recorded, for a booking made at the checkout and for one made on a customer's behalf, and the provider's finish moves neither the bill nor the payout",
                kind: 'in-process',
                cases: [spec('acceptance-seams.spec.js', 'Seams: W2 charge:')],
            },
        ],
    },
    {
        n: 3,
        hard: false,
        says: "An admin can book a job on a customer's behalf through the website flow; the booking appears in the admin portal, and the customer receives the quote by email and SMS with a working link to add their card on file.",
        clauses: [
            {
                id: 'W3.website-flow',
                says: "an admin books for a customer through the website's booking flow",
                cases: [spec('on-behalf-booking.spec.js', 'an admin on the confirm screen creates the booking', 'the schedule screen in the mode prices a job', "the admin's entry lists the services", 'a quote request has "Book this"', 'an admin books for a customer who phoned in')],
            },
            {
                id: 'W3.quote-by-email-and-text',
                says: 'the customer is sent the quote and the card link by email and by text',
                kind: 'attempt',
                cases: [spec('notices-routes.spec.js', 'R3:'), spec('notices-events.spec.js', 'E4 ')],
            },
            {
                id: 'W3.card-link',
                says: 'the link in the message opens a page where the customer adds a card',
                kind: 'in-process',
                cases: [spec('on-behalf-booking.spec.js', 'the card panel shows the card and the link', 'a succeeded SetupIntent saves the brand and last four')],
            },
        ],
    },
    {
        n: 4,
        hard: false,
        says: 'A provider can add cleaners to their crew list and assign them to a job, and each assigned cleaner receives the job link by text.',
        clauses: [
            {
                id: 'W4.crew-list',
                says: 'a provider adds cleaners to their crew list',
                cases: [spec('provider-crew.spec.js', 'AC1: a provider adds Sam', 'AC1: a provider corrects a name', 'AC1: removing a member drops it')],
            },
            {
                id: 'W4.assign',
                says: 'a provider assigns cleaners to a job',
                cases: [spec('provider-crew.spec.js', 'AC2: a job the admin gave to the provider takes two members', 'AC2: a job claimed from the marketplace takes a crew')],
            },
            {
                id: 'W4.link-by-text',
                says: 'each assigned cleaner is sent the job link by text',
                kind: 'attempt',
                cases: [spec('notices-routes.spec.js', 'R10:', 'R11:', 'R12:', 'R13:'), spec('notices-events.spec.js', 'E9 ', 'E10 ', 'E11 ', 'E12 '), spec('acceptance-journey.spec.js', 'Journey: texts')],
            },
        ],
    },
    {
        n: 5,
        hard: true,
        says: 'A job can only be started from its link by an assigned cleaner who has entered the code sent to their phone, the provider, or a WorkOnTap admin, within the check-in window, after before photos are taken, with the location recorded.',
        clauses: [
            {
                id: 'W5.cleaner-with-code',
                says: 'the assigned cleaner who entered the code sent to their phone can start the job',
                cases: [
                    spec('job-timer.spec.js', 'AC2: (hard gate)', 'AC7: a whole flow'),
                    spec('job-timer-screens.spec.js', 'Screens: Start the job takes the phone'),
                    spec('acceptance-links.spec.js', 'Links: W5 the cleaner with the code, the provider and an admin each start'),
                    spec('acceptance-journey.spec.js', 'Journey: W5 code', 'Journey: W5 photo'),
                ],
            },
            {
                id: 'W5.provider',
                says: 'the job\'s provider can start the job',
                cases: [spec('job-timer.spec.js', 'AC2: (hard gate)'), spec('acceptance-links.spec.js', 'Links: W5 the cleaner with the code, the provider and an admin each start')],
            },
            {
                id: 'W5.admin',
                says: 'a WorkOnTap admin can start the job',
                cases: [spec('job-timer.spec.js', 'AC2: (hard gate)'), spec('acceptance-links.spec.js', 'Links: W5 the cleaner with the code, the provider and an admin each start')],
            },
            {
                id: 'W5.nobody-else',
                says: 'nobody else can start it: every other caller gets the link\'s one 401 and nothing is written',
                cases: [
                    spec('job-timer-access.spec.js', 'Access: no way in is the one 401'),
                    spec('job-link-access.spec.js', 'AC4:', 'AC5:', 'AC6:'),
                    spec('acceptance-links.spec.js', 'Links: W5 a start by'),
                ],
            },
            {
                id: 'W5.window',
                says: 'the job is started within the check-in window, and the window is shut before it opens',
                cases: [
                    spec('job-checkin.spec.js', 'AC10: a job dated tomorrow', 'AC10: a job dated today after its window opened'),
                    spec('job-checkin-refusals.spec.js', 'Refusal 3'),
                    spec('job-link-screens.spec.js', 'Screens: before the window the tick list is shut'),
                    spec('acceptance-links.spec.js', 'Links: W5 a start is refused, and nothing is written, when only this is wrong: the window shut'),
                ],
            },
            {
                id: 'W5.before-photo',
                says: 'the job cannot be started until a before photo is taken',
                cases: [
                    spec('job-timer.spec.js', 'AC2: (hard gate)', 'AC7: a whole flow'),
                    spec('job-timer-screens.spec.js', 'Screens: while the job has not started the Start button is off'),
                    spec('job-timer-page.spec.js', 'Screens: the job can not be started until a before photo is taken'),
                    spec('acceptance-links.spec.js', 'Links: W5 a start is refused, and nothing is written, when only this is wrong: no before photo'),
                    spec('acceptance-journey.spec.js', 'Journey: W5 photo'),
                ],
            },
            {
                id: 'W5.location',
                says: 'the cleaner\'s location is recorded with the start, and a start with no usable position is refused',
                cases: [
                    spec('job-timer.spec.js', 'AC2: (hard gate)', 'AC7: a whole flow'),
                    spec('job-timer-screens.spec.js', 'Screens: Start the job takes the phone', 'Screens: when the phone will not give its position Start says why'),
                    spec('job-checkin.spec.js', 'AC11: no location'),
                    spec('acceptance-links.spec.js', 'Links: W5 a start with no position is refused'),
                ],
            },
            {
                id: 'W5.one-at-a-time',
                says: 'each thing a start needs is refused on its own with the rest right, and the same job starts once that one thing is put right: no before photo, no one checked in, a pending job, a shut window, no position',
                cases: [spec('acceptance-links.spec.js', 'Links: W5 a start is refused, and nothing is written, when only this is wrong:', 'Links: W5 a start with no position is refused')],
            },
            {
                id: 'W5.one-door',
                says: 'the job link is the only way to start a job',
                kind: 'departure',
                cases: [spec('job-timer.spec.js', 'AC2: (hard gate)'), spec('acceptance-links.spec.js', 'Links: W5.one-door')],
                departure: {
                    what: "The provider's own page can also start a confirmed job that has a before photo, with no check-in and no location recorded, through a second route (time-tracking). It does not go through the job link, the check-in window or the position.",
                    from: 'A job can only be started from its link, within the check-in window, with the location recorded.',
                    accepted: null,
                },
            },
        ],
    },
    {
        n: 6,
        hard: false,
        says: 'One person can check in every assigned cleaner who showed up, and add a late arrival later.',
        clauses: [
            {
                id: 'W6.check-in-everyone',
                says: 'one person checks in every assigned cleaner who showed up, all or none',
                cases: [spec('job-checkin.spec.js', 'AC8: a cleaner session ticks three members'), spec('job-checkin-refusals.spec.js', 'Refusal 2'), spec('job-link-screens.spec.js', 'Screens: at the address a tick checks in the people ticked')],
            },
            {
                id: 'W6.late-arrival',
                says: 'a late arrival is added later',
                cases: [spec('job-checkin.spec.js', 'AC9: after three, one more id is added'), spec('acceptance-journey.spec.js', 'Journey: W6 late')],
            },
            {
                id: 'W6.no-show',
                says: 'a cleaner who did not show is not checked in',
                cases: [spec('job-checkin.spec.js', 'AC8: a cleaner session ticks three members', 'AC15: the view lists every assigned member'), spec('acceptance-journey.spec.js', 'Journey: W6 no-show')],
            },
        ],
    },
    {
        n: 7,
        hard: false,
        says: "The timer counts down the job's quoted hours divided by the cleaners checked in, re-divides when a cleaner is added or checked out, and shows the assigned crew and who is checked in.",
        clauses: [
            {
                id: 'W7.countdown',
                says: 'the timer counts down the quoted time divided by the cleaners checked in',
                cases: [spec('job-timer.spec.js', 'AC3: three cleaners checked in on a 360-minute job'), spec('job-timer-page.spec.js', 'Screens: the clock divides the quoted time among the cleaners here')],
            },
            {
                id: 'W7.re-divides',
                says: 'it re-divides when a cleaner is added or checked out',
                cases: [spec('job-timer.spec.js', 'AC4: an hour on, a fourth cleaner checking in', 'AC4: a cleaner taken off the crew'), spec('acceptance-journey.spec.js', 'Journey: W7 re-divides')],
            },
            {
                id: 'W7.arithmetic',
                says: 'the clock arithmetic: the time left is shared among the cleaners here, paused time is not counted',
                kind: 'in-process',
                cases: [spec('job-clock.spec.js', 'AC3:', 'AC4:', 'AC5:', 'AC6:')],
            },
            {
                id: 'W7.crew-shown',
                says: 'it shows the assigned crew and who is checked in',
                cases: [spec('job-link-screens.spec.js', 'Screens: a signed-in cleaner sees the days, the address, the details and the whole crew'), spec('job-checkin.spec.js', 'AC15: the view lists every assigned member')],
            },
        ],
    },
    {
        n: 8,
        hard: false,
        says: 'Each of the five on-site reports reaches the admin queue and alerts admin and the provider; added items are charged only after admin approval.',
        clauses: [
            {
                id: 'W8.five-kinds',
                says: 'each of the five on-site reports is kept with its photo',
                cases: [spec('job-reports.spec.js', 'each of the five reports is kept with its photo', 'a send made again with the same client_token', 'two sends made at the same moment', 'every refusal says no-store')],
            },
            {
                id: 'W8.admin-queue',
                says: 'the reports reach the admin queue',
                cases: [spec('job-reports.spec.js', 'the queue lists the report with its job'), spec('acceptance-seams.spec.js', 'Seams: W8 queue:'), spec('acceptance-journey.spec.js', 'Journey: W8 queue')],
            },
            {
                id: 'W8.alerts',
                says: 'admin and the provider are alerted by text and by email',
                kind: 'attempt',
                cases: [spec('notices-routes.spec.js', 'R14:'), spec('notices-events.spec.js', 'E14 '), spec('acceptance-seams.spec.js', 'Seams: W8 alerts:'), spec('acceptance-journey.spec.js', 'Journey: W8 alerts')],
            },
            {
                id: 'W8.no-charge-before-approval',
                says: 'added items are not charged before the admin approves them',
                cases: [spec('job-reports.spec.js', 'each of the five reports is kept with its photo', 'decline closes any open report', 'approving on a server with no payment key is a 503')],
            },
            {
                id: 'W8.charged-after-approval',
                says: 'an approved sum is charged once, on the saved card',
                kind: 'in-process',
                cases: [spec('report-desk.spec.js', 'an approved sum is charged on the card on file in an intent of its own'), spec('acceptance-seams.spec.js', 'Seams: W8 charge:')],
            },
        ],
    },
    {
        n: 9,
        hard: true,
        says: 'Every booked job appears in the admin queue; admin can assign it directly or push it to the marketplace, and once a job is claimed, no second provider can also claim it.',
        clauses: [
            {
                id: 'W9.every-job-in-queue',
                says: 'every booked job appears in the admin queue',
                cases: [
                    spec('marketplace.spec.js', 'an unassigned booking is in the admin job queue as waiting', 'unassigning a booking returns it to the queue'),
                    spec('recurring-visits.spec.js', 'each visit of a series is its own job in the admin queue'),
                    spec('acceptance-seams.spec.js', 'Seams: W9 queue:'),
                ],
            },
            {
                id: 'W9.assign-directly',
                says: 'admin assigns a job directly',
                cases: [spec('marketplace.spec.js', 'an admin assigns a waiting booking to provider 1', 'an admin assignment to a different provider is a 409')],
            },
            {
                id: 'W9.push-to-marketplace',
                says: 'admin pushes a job to the marketplace, and a job not pushed is not offered',
                cases: [spec('marketplace.spec.js', 'a booking no admin has pushed is not in providers', 'an admin push puts a booking on the marketplace')],
            },
            {
                id: 'W9.no-second-claim',
                says: 'once a job is claimed, no second provider can claim it, by either claim route',
                cases: [
                    spec('marketplace.spec.js', 'a claimed booking refuses a second claim from either provider on both claim routes'),
                    spec('ownership.spec.js', "Ownership POST /api/provider/available-jobs/[id]: provider1 accepting provider 2's booking is 403", 'Ownership POST /api/provider/available-jobs: provider1 claims an open booking'),
                    spec('acceptance-seams.spec.js', 'Seams: W9 claim:'),
                ],
            },
            {
                id: 'W9.claim-race',
                says: 'two providers claiming one job at the same moment: exactly one gets it',
                cases: [spec('marketplace.spec.js', 'two providers claiming one pushed booking at once through POST /api/provider/available-jobs:', 'two providers claiming one pushed booking at once through POST /api/provider/available-jobs/[id]:', 'an admin assignment and a provider claim on one pushed booking at once')],
            },
        ],
    },
    {
        n: 10,
        hard: false,
        says: 'The right transactional SMS and email fires for every quote requested, quote and card link sent, job booked, assigned and claimed, job link sent, and on-site report.',
        clauses: [
            { id: 'W10.quote-requested', says: 'a quote requested', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R1:', 'R2:'), spec('notices-events.spec.js', 'E1 ', 'E2 ', 'E3 ')] },
            { id: 'W10.quote-and-card-link', says: 'a quote and card link sent', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R3:'), spec('notices-events.spec.js', 'E4 ')] },
            { id: 'W10.job-booked', says: 'a job booked', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R4:'), spec('notices-events.spec.js', 'E5 '), spec('acceptance-seams.spec.js', 'Seams: W10 booked:')] },
            { id: 'W10.job-assigned', says: 'a job assigned or reassigned', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R5:', 'R6:', 'R9 '), spec('notices-events.spec.js', 'E6 ', 'E7 ')] },
            { id: 'W10.job-claimed', says: 'a job claimed', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R7:', 'R8:'), spec('notices-events.spec.js', 'E8 ')] },
            { id: 'W10.job-link-sent', says: 'a job link sent', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R10:', 'R11:', 'R12:', 'R13:'), spec('notices-events.spec.js', 'E9 ', 'E10 ', 'E11 ', 'E12 '), spec('acceptance-journey.spec.js', 'Journey: texts')] },
            { id: 'W10.on-site-report', says: 'an on-site report', kind: 'attempt', cases: [spec('notices-routes.spec.js', 'R14:'), spec('notices-events.spec.js', 'E14 ')] },
        ],
    },
    {
        n: 11,
        hard: true,
        says: 'Every one of the nine defects above is re-tested and closed.',
        clauses: defectClauses,
    },
    // Case 13 of the design: the three route files outside src/app/api, which no route table lists, read at the head this map was written against.
    //   src/app/uploads/[...file]/route.js    anyone who has the URL, by design: it serves a file under public/uploads, asks for no credential and
    //                                         sends a public, immutable cache header.
    //   src/app/_uploads/[...path]/route.js   no one: the leading underscore makes the folder private to the router, so the file is never routed
    //                                         (GET /_uploads/x answers the app's HTML 404 page where GET /uploads/x answers 'File not found').
    //   src/app/llms.txt/route.js             anyone, by design: a public index of the active services, the active locations and the published posts.
    // None serves anything but a file or a public index, so none has a case of its own.
    {
        n: 12,
        hard: true,
        says: "No customer, provider, cleaner, or stranger can reach another account's data or actions they're not authorized for.",
        clauses: [
            {
                id: 'W12.every-route-by-role',
                says: 'every guarded route answers each role as the route table says, with every credential style',
                cases: [group('auth-matrix.spec.js', 'Role by route'), group('role-checks.spec.js', 'Role check by row')],
            },
            {
                id: 'W12.every-route-has-a-row',
                says: 'no route file is left out of the table (read from the source tree, no request is made)',
                kind: 'in-process',
                cases: [group('auth-coverage.spec.js', 'Auth coverage - routes')],
            },
            {
                id: 'W12.guard',
                says: 'the guard refuses a missing, forged, expired or wrong-role credential',
                kind: 'in-process',
                cases: [wholeFile('auth-guard.spec.js'), group('role-checks.spec.js', 'Role check forged tokens')],
            },
            {
                id: 'W12.customer-and-stranger',
                says: "a customer or a stranger cannot read or change another account's bookings, reviews, chats or addresses",
                cases: [
                    group('defects.spec.js', 'AC6 cross-account bookings'),
                    group('defects.spec.js', 'Reviews, GET /api/reviews'),
                    group('defects.spec.js', 'D1 receipt page'),
                    wholeFile('ownership.spec.js'),
                    group('role-checks.spec.js', 'Role check ownership'),
                    spec('acceptance-links.spec.js', 'Links: POST /api/job/[token]/check-in refuses no credential or a customer', 'Links: POST /api/job/[token]/reports refuses no credential or a customer'),
                ],
            },
            {
                id: 'W12.provider',
                says: "a provider cannot reach another provider's jobs, crew or profile",
                cases: [
                    spec('provider-crew.spec.js', 'AC3 (hard gate)', 'AC4 (hard gate)'),
                    spec('marketplace.spec.js', 'a provider gets 403 assigning a booking to themselves'),
                    spec('acceptance-links.spec.js', 'Links: POST /api/job/[token]/check-in refuses provider 2 or the previous provider', 'Links: POST /api/job/[token]/reports refuses provider 2 or the previous provider'),
                ],
            },
            {
                id: 'W12.cleaner-on-the-link',
                says: "a cleaner's link session reaches only its own job's link",
                cases: [
                    spec('job-timer-access.spec.js', 'Access: every dead link is the one 404', 'Access: no way in is the one 401'),
                    spec('job-link-access.spec.js', 'AC5:', 'AC6:'),
                    spec(
                        'acceptance-links.spec.js',
                        'Links: POST /api/job/[token]/check-in refuses a cleaner who is not on the crew now',
                        'Links: POST /api/job/[token]/reports refuses a cleaner who is not on the crew now',
                        "Links: the cleaner with the code, the job's provider and an admin are let in"
                    ),
                ],
            },
            {
                id: 'W12.cleaner-on-the-portals',
                says: "a cleaner's link session is turned away at every role-guarded route of the portals, one case per HTTP method the route table holds",
                cases: [spec('acceptance-roles.spec.js', 'Roles:')],
            },
        ],
    },
];

/**
 * Cases the dev environment cannot run, which the gate accepts as SKIPPED and prints with the reason. The note for the client
 * carries each one. Nothing else may skip.
 */
export const NAMED_GAPS = [
    {
        key: "ownership.spec.js › Ownership: customer account › Ownership GET /api/user/addresses: the owner reads their addresses (not observable: the dev database has no user_addresses table, the query answers 500)",
        outcome: 'SKIPPED',
        because: "the dev database has no user_addresses table, so the owner's read of an address cannot be observed",
        note: 'The address owner checks in the user-addresses route are not exercised by any case. Ask which table holds addresses before production.',
    },
    {
        key: "ownership.spec.js › Ownership: customer account › Ownership DELETE /api/user/addresses/[id] and PUT /api/user/addresses/[id]: another customer's address is 403 (not observable: no user_addresses table, no address row to ask for)",
        outcome: 'SKIPPED',
        because: "there is no address row to ask for another customer's address",
        note: 'The same gap: another customer\'s address cannot be asked for.',
    },
];
