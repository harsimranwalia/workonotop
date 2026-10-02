// database/fixtures/index.js
// The ordered list of fixture sets. To add one, create database/fixtures/<name>.js exporting
//   { name, tables: { <table>: [row, ...] } }
// and list it here. Every row of a table must have the same keys, with explicit ids and created_at /
// updated_at (see accounts.js). Tables load in the order written, sets in the order listed, so a set may
// reference rows of any set before it.
import bcryptjs from 'bcryptjs';
import { users, providers } from './accounts.js';
import { catalog } from './catalog.js';

// A fixed salt makes every load write the same hash bytes, which is what lets CHECKSUM TABLE show that a
// second load changed nothing. Cost 10 is the cost the app's own signup uses. A salt is not a secret.
const PASSWORD_SALT = '$2b$10$JWQ/wr1uytZ9ElQsxlehgO';
const hash = (password) => bcryptjs.hashSync(password, PASSWORD_SALT);

// users keeps its hash in password_hash and service_providers in password; the plain-text dummy that
// accounts.js holds in `password` is replaced in both.
const accounts = {
  name: 'accounts',
  tables: {
    users: users.map(({ password, ...row }) => ({ ...row, password_hash: hash(password) })),
    service_providers: providers.map((row) => ({ ...row, password: hash(row.password) })),
  },
};

export const fixtureSets = [accounts, catalog];
