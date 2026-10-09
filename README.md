# workontap-2

## Test fixtures and the e2e suite

`npm run db:fixtures` puts the dev database in one known synthetic state. In one transaction it deletes every row of every table and inserts the rows in `database/fixtures/`, so a failed load changes nothing and a second load writes the same rows. It reads `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` like the other scripts, and refuses anything but a local `workontap_db` (host `db`, `localhost`, `127.0.0.1` or `::1`) that holds no real person's email. Nothing overrides that.

`npm test` runs the Playwright suite in `e2e/` against `E2E_BASE_URL` (default `http://localhost:3000`). It needs the app running and the fixtures loaded, and stops at the start if they are not. Sign-in, sign-up and session checks need `JWT_SECRET` in the app's environment (for `next dev`, put it in `.env.development.local`); without it the sign-in routes answer 500 and no session is accepted.

Fixture identities, in `database/fixtures/accounts.js`: emails `fixture-<role>-<n>@workontap.test` (a row a test creates uses `e2e-<purpose>-<random>@workontap.test`), phones `+1403555 01NN`, names like "Fixture Customer One", no external URLs. Their passwords are dummies and are committed with the code. Never create a fixture account in a migration: migrations reach production.

To add a fixture set, create `database/fixtures/<name>.js` exporting `{ name, tables: { <table>: [rows] } }` (same keys in every row, and explicit ids and fixed timestamps where the table has them) and list it in `database/fixtures/index.js`.

`e2e/baseline.json` records which cases fail today, so a new failure can be told from an old one. It is a record, not a filter: every failure still fails the run. A change that alters a case's outcome on purpose updates it in the same PR, copied from `test-results/baseline-candidate.json` after a full run with the fixtures loaded.

A case that needs a Stripe, SMS or email credential the app does not have is reported `ATTEMPTED (missing: ...)`, never `PASS`: see `credentialGap` in `e2e/support/credentials.js`.
