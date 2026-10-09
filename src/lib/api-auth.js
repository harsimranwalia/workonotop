// src/lib/api-auth.js
//
// The one place an API route decides who is asking and which role they hold (ENG-004 design, Interfaces;
// ADR-003). A handler that is not public by design calls the guard first, before it reads the body:
//
//   const auth = await requireCaller(request, ['admin']);
//   if (!auth.ok) return auth.response;
//   // auth.caller is { role: 'admin' | 'customer' | 'provider', id (a number), email, via: 'cookie' | 'bearer' }
//
// Credentials, tried in this order, each verified on its own: the adminAuth, customer_token and provider_token
// cookies, then the Authorization: Bearer header. A Bearer that verifies is judged on the claims it was signed
// with, never on the session object getMobileSession builds from it (that one rewrites `type`), and a Bearer with
// whitespace inside is no session at all (getMobileSession would read a different string than this guard judged).
// Only a string that does not verify can still be a session, by being the issued string in mobile_auth_users. The
// first one whose role is in `roles` wins. The role comes from the signed payload, never from which cookie carried
// it, and a cookie whose payload names another role than the cookie's own name never grants anything: a customer's
// token copied into adminAuth is not an admin session. It does count as a verified session, though (the signature
// is good), so a request that carries only that answers 403 Forbidden, never 401 and never access.
//
// 401 { success: false, message: 'Unauthorized' }: no session verified (nothing sent, malformed, bad signature,
//     expired, or a signed token that is not a session: a `role` claim that is not admin, provider, user or customer
//     (whatever `type` says), a special-purpose token, no usable id). A usable id is a positive safe integer or the
//     digits of one ('21' is returned as 21); '5abc', 1.5, '007', '1e3' and 0 are not ids, because the handlers put
//     the id into SQL, where MySQL reads '5abc' as 5.
// 403 { success: false, message: 'Forbidden' }: a session verified but none has an allowed role. A wrong role is
//     never a 401: the mobile app parks a call that gets a second 401 (design, "Mobile app").
//
// Imports use explicit ./x.js paths (not the @/ alias) so the guard also loads in plain Node, for the guard-level
// spec. The refusals are standard Response objects for the same reason; a route handler may return one.
import crypto from 'node:crypto';
import { verifyToken } from './jwt.js';
import { getMobileSession } from './mobile-auth.js';

const ROLES = ['admin', 'customer', 'provider'];

// The web logins' cookies, in the order the guard tries them, and the one role each may carry.
const COOKIES = [
  { name: 'adminAuth', role: 'admin' },
  { name: 'customer_token', role: 'customer' },
  { name: 'provider_token', role: 'provider' },
];

// What a payload's `role` or `type` claim may say. Exact match, no case folding, no guessing from other fields.
// A Map, so a claim such as 'constructor' finds nothing.
const CLAIMS = new Map([
  ['admin', 'admin'],
  ['provider', 'provider'],
  ['user', 'customer'],
  ['customer', 'customer'],
]);

// Signed with the same secret, emailed inside links, and never a session (jwt.js: email verification and
// password reset). Without this a token carrying only providerId and type would read as a provider.
const SPECIAL_PURPOSE_TYPES = new Set(['email_verification', 'password_reset']);

function refusal(status, message) {
  return Response.json({ success: false, message }, { status });
}

// roles is a programming input, not a request input: a wrong value is a bug in the handler, found the first
// time the handler runs, so it throws (from inside the async function, so the caller sees a rejection).
function assertRoles(roles, who) {
  if (!Array.isArray(roles) || roles.length === 0 || roles.some((role) => !ROLES.includes(role))) {
    throw new Error(`${who}: roles must be a non-empty array of ${ROLES.join(' | ')}, got ${JSON.stringify(roles)}`);
  }
}

function roleOfClaim(value) {
  return typeof value === 'string' ? (CLAIMS.get(value) ?? null) : null;
}

// The role a verified payload names, or null when it names none (null means "not a session").
function roleOf(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (SPECIAL_PURPOSE_TYPES.has(payload.type)) return null;
  const byRole = roleOfClaim(payload.role);
  // A role claim that is there and is not one of the four is refused outright, even when `type` is recognised:
  // {role: 'superuser', type: 'user'} is not a customer. No login signs one. `undefined` (a key that JSON leaves
  // out) and `null` are the same absence.
  if (payload.role !== undefined && payload.role !== null && !byRole) return null;
  const byType = roleOfClaim(payload.type);
  // Two claims that disagree are not a token any login issues; refuse rather than pick one.
  if (byRole && byType && byRole !== byType) return null;
  const role = byRole ?? byType;
  // Admin is only ever the role claim the admin login signs, never inferred from `type`.
  if (role === 'admin' && byRole !== 'admin') return null;
  return role;
}

// A usable id as a number, or null: a positive safe integer, or a string of its digits (no sign, no leading zero, no
// fraction, no exponent, no blank, nothing after the digits). Anything looser reaches SQL, where MySQL reads '5abc'
// as 5 in an integer comparison.
function idNumber(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

// A provider's id is `providerId` (the web provider token carries only that) when that is usable, else `id`;
// everyone else's is `id`. A number, or null.
function idOf(role, payload) {
  if (role === 'provider') {
    const providerId = idNumber(payload.providerId);
    if (providerId !== null) return providerId;
  }
  return idNumber(payload.id);
}

// A verified payload or mobile session -> the normalised caller, or null when it is not a session.
function toCaller(payload, via) {
  const role = roleOf(payload);
  if (!role) return null;
  const id = idOf(role, payload);
  if (id === null) return null;
  return { role, id, email: typeof payload.email === 'string' ? payload.email : null, via };
}

// Reads a cookie from the Cookie header, so a plain Request works as well as a NextRequest. Later duplicates
// win, as with request.cookies.get.
function cookieValue(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  let found = null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    let value = part.slice(at + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      found = decodeURIComponent(value);
    } catch {
      found = value;
    }
  }
  return found === '' ? null : found;
}

function bearerToken(request) {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

// The Bearer path. A token that verifies is judged on its own signed claims (verifyToken's payload), never on the
// object getMobileSession returns for it: that object rewrites `type` to `role || type`, which turns a special-purpose
// or a disagreeing token into a session. Only a string that does not verify can still be a session, as the issued
// string in mobile_auth_users (a database that is down, or finds no row, reads as null: no session). The fix lives
// here and not in mobile-auth.js, which nine other route files import (auth/me, provider/status, seven provider/onboarding).
//
// getMobileSession re-reads the header and looks up only its second space-separated word, so a header with
// whitespace inside ('Bearer <valid> x') would be judged on a different string than this guard has; no token the
// server issues (a JWT, a hex refresh token) has whitespace, so such a header is no session and is not looked up.
//
// The lookup still runs first, as the design orders it. getMobileSession keeps everything it does inside one
// try/catch and answers null, so it does not reject; if a later edit lets it, the rejection is not caught here (a
// catch that only said `session = null` would be a silent fall-through to the signature) but reaches
// resolveSafely, which logs one line and answers 401: fail-closed and not silent.
async function bearerCaller(request, token) {
  if (/\s/.test(token)) return null;
  const session = await getMobileSession(request);
  return toCaller(verifyToken(token) ?? session, 'bearer');
}

/**
 * Looks at the credentials in order and returns { allowed, seen }: `allowed` is the first caller whose role is in
 * `roles` (or any role when `roles` is null), `seen` is true when any session verified at all. It stops at the
 * first allowed caller, so a request that a cookie settles never reaches the database lookup.
 */
async function resolve(request, roles) {
  let seen = false;
  const accepts = (caller) => roles === null || roles.includes(caller.role);

  for (const cookie of COOKIES) {
    const value = cookieValue(request, cookie.name);
    if (!value) continue;
    const caller = toCaller(verifyToken(value), 'cookie');
    if (!caller) continue;
    seen = true;
    // A cookie only carries its own role; any other payload in it is verified but not a credential.
    if (caller.role === cookie.role && accepts(caller)) return { allowed: caller, seen };
  }

  const token = bearerToken(request);
  if (token) {
    const caller = await bearerCaller(request, token);
    if (caller) {
      seen = true;
      if (accepts(caller)) return { allowed: caller, seen };
    }
  }
  return { allowed: null, seen };
}

// Anything unexpected while reading a credential is "no session", never an exception out of the guard.
async function resolveSafely(request, roles) {
  try {
    return await resolve(request, roles);
  } catch (error) {
    console.error('api-auth: could not read the request credentials:', error?.message);
    return { allowed: null, seen: false };
  }
}

/**
 * The guard. `roles` is a non-empty subset of 'admin' | 'customer' | 'provider' (no "any signed-in user"
 * wildcard: a route that allows all three names all three). Never reads the request body.
 * @param {Request} request
 * @param {Array<'admin'|'customer'|'provider'>} roles
 * @returns {Promise<{ ok: true, caller: { role: string, id: number, email: string|null, via: 'cookie'|'bearer' } } | { ok: false, response: Response }>}
 */
export async function requireCaller(request, roles) {
  assertRoles(roles, 'requireCaller');
  const { allowed, seen } = await resolveSafely(request, roles);
  if (allowed) return { ok: true, caller: allowed };
  return { ok: false, response: seen ? refusal(403, 'Forbidden') : refusal(401, 'Unauthorized') };
}

/**
 * The normaliser, for a route that is public but behaves differently for a signed-in caller (an admin flag, a
 * booking owned by the signed-in customer). Returns the first verified caller whose role is in `roles` (any role
 * when `roles` is left out), or null. Never refuses and never reads the body.
 * @param {Request} request
 * @param {Array<'admin'|'customer'|'provider'>} [roles]
 * @returns {Promise<{ role: string, id: number, email: string|null, via: 'cookie'|'bearer' } | null>}
 */
export async function callerFrom(request, roles) {
  if (roles !== undefined) assertRoles(roles, 'callerFrom');
  const { allowed } = await resolveSafely(request, roles ?? null);
  return allowed;
}

function sameSecret(given, expected) {
  if (typeof given !== 'string' || given === '') return false;
  // Equal-length digests, so the comparison does not depend on how much of the secret was guessed.
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * The cron routes' own check, fail-closed: with CRON_SECRET unset every request is refused (the old checks ran
 * the job for anyone). The secret is accepted the two ways the cron routes accept it today: Authorization:
 * Bearer <secret>, or ?secret=<secret>. Same result shape as requireCaller.
 * @param {Request} request
 * @returns {{ ok: true } | { ok: false, response: Response }}
 */
export function requireCronSecret(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('CRON_SECRET is not set: refusing the cron request.');
    return { ok: false, response: refusal(401, 'Unauthorized') };
  }
  let fromQuery = null;
  try {
    fromQuery = new URL(request.url).searchParams.get('secret');
  } catch (error) {
    // A url that cannot be parsed has no ?secret=, so only the Bearer header can still pass; say so, once.
    console.error('api-auth: could not read ?secret= from the cron request url:', error?.message);
  }
  if (sameSecret(bearerToken(request), expected) || sameSecret(fromQuery, expected)) return { ok: true };
  return { ok: false, response: refusal(401, 'Unauthorized') };
}
