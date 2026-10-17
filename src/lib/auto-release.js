// src/lib/auto-release.js
//
// How long a finished job waits for its customer before the sweep (src/app/api/cron/auto-release/route.js) approves it and takes the payment, in hours.
// One constant, so the words that tell a guest customer when their card is charged (src/lib/notice-events.js, ENG-018) cannot drift from the sweep's own
// window: a guest cannot approve, and the card on file is charged when this many hours have passed. e2e/notices-events.spec.js reads the route and
// fails if it spells the window as a number again.
export const AUTO_RELEASE_HOURS = 24;
