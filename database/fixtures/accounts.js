// database/fixtures/accounts.js
// The people the fixtures create, as rows of their own tables. Plain data with no imports, so the
// e2e helpers read the very credentials the loader writes.
//
// Identity rules, binding on every fixture set, this one and later ones:
// - Email: fixture-<role>-<n>@workontap.test for rows defined here, and e2e-<purpose>-<random>@workontap.test
//   for rows a test creates. .test is reserved (RFC 2606), so nothing sent to it can reach a mailbox.
// - Phone: +1403555 01NN. NANP 555-0100..0199 is reserved for fiction, and the +1 keeps it E.164 so that
//   src/lib/sms.js does not prefix +91.
// - Names: "Fixture Customer One", "Fixture Provider One", "Fixture Admin".
// - No external URLs: image_url and avatar_url stay NULL.
// - Passwords are obviously dummy and committed. They open only @workontap.test accounts that only the
//   fixture command creates, in a database it refuses to write unless that database holds no real person.
//   No migration may create a fixture account, because migrations reach production.
//
// `password` in a row is the plain-text dummy. index.js replaces it with the bcrypt hash before the insert.

// Every fixture row carries this time, so two loads write the same bytes.
const FIXED_AT = '2026-01-01 00:00:00';

const customer1 = {
  id: 1,
  email: 'fixture-customer-1@workontap.test',
  password: 'fixture-customer-1-password',
  first_name: 'Fixture',
  last_name: 'Customer One',
  phone: '+14035550101',
  role: 'user',
  status: 'active',
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
};

const customer2 = {
  id: 2,
  email: 'fixture-customer-2@workontap.test',
  password: 'fixture-customer-2-password',
  first_name: 'Fixture',
  last_name: 'Customer Two',
  phone: '+14035550102',
  role: 'user',
  status: 'active',
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
};

// Customers and admins are both rows of `users`; role tells them apart.
const admin = {
  id: 3,
  email: 'fixture-admin-1@workontap.test',
  password: 'fixture-admin-1-password',
  first_name: 'Fixture',
  last_name: 'Admin',
  phone: '+14035550103',
  role: 'admin',
  status: 'active',
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
};

// Active and fully onboarded, which is what provider/layout.js needs to show the dashboard.
// Stripe stays unconnected: there is no Stripe account in this environment.
const provider1 = {
  id: 1,
  name: 'Fixture Provider One',
  email: 'fixture-provider-1@workontap.test',
  password: 'fixture-provider-1-password',
  phone: '+14035550111',
  status: 'active',
  email_verified: 1,
  onboarding_completed: 1,
  documents_uploaded: 1,
  documents_verified: 1,
  stripe_onboarding_complete: 0,
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
};

const provider2 = {
  id: 2,
  name: 'Fixture Provider Two',
  email: 'fixture-provider-2@workontap.test',
  password: 'fixture-provider-2-password',
  phone: '+14035550112',
  status: 'active',
  email_verified: 1,
  onboarding_completed: 1,
  documents_uploaded: 1,
  documents_verified: 1,
  stripe_onboarding_complete: 0,
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
};

export const users = [customer1, customer2, admin];
export const providers = [provider1, provider2];

// Each role signs in through its own route and gets its own cookie, so a login names the route too.
const login = (row, loginRoute) => ({ email: row.email, password: row.password, loginRoute });

export const FIXTURE_LOGINS = {
  customer1: login(customer1, '/api/auth/login'),
  customer2: login(customer2, '/api/auth/login'),
  provider1: login(provider1, '/api/provider/login'),
  provider2: login(provider2, '/api/provider/login'),
  admin: login(admin, '/api/admin/login'),
};
