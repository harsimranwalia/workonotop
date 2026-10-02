// src/lib/api-auth.js
//
// The one place an API route decides who is asking and which role they hold (ENG-004 design, Interfaces;
// ADR-003). A handler that is not public by design calls the guard first, before it reads the body:
//
//   const auth = await requireCaller(request, ['admin']);
//   if (!auth.ok) return auth.response;
//   // auth.caller is { role: 'admin' | 'customer' | 'provider', id, email, via: 'cookie' | 'bearer' }
//
// Credentials, tried in this order, each verified on its own: the adminAuth, customer_token and provider_token
// cookies, then the Authorization: Bearer header (getMobileSession first, then verifyToken). The first one whose
// role is in `roles` wins. The role comes from the signed payload, never from which cookie carried it, and a
// cookie whose payload names another role than the cookie's own name is not a credential for anything: a
// customer's token copied into adminAuth is not an admin session.
//
// 401 { success: false, message: 'Unauthorized' }: no session verified (nothing sent, malformed, bad signature,
//     expired, or a signed token that is not a session: unknown role, a special-purpose token, no id).
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
  const byType = roleOfClaim(payload.type);
  // Two claims that disagree are not a token any login issues; refuse rather than pick one.
  if (byRole && byType && byRole !== byType) return null;
  const role = byRole ?? byType;
  // Admin is only ever the role claim the admin login signs, never inferred from `type`.
  if (role === 'admin' && byRole !== 'admin') return null;
  return role;
}

function validId(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string' && value.trim() !== '';
}

// A provider's id is `providerId` (the web provider token carries only that); everyone else's is `id`.
function idOf(role, payload) {
  if (role === 'provider') return validId(payload.providerId) ? payload.providerId : payload.id;
  return payload.id;
}

// A verified payload or mobile session -> the normalised caller, or null when it is not a session.
function toCaller(payload, via) {
  const role = roleOf(payload);
  if (!role) return null;
  const id = idOf(role, payload);
  if (!validId(id)) return null;
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

// The Bearer path: the issued string in mobile_auth_users first; when that finds nothing (including a database
// that is down, which getMobileSession turns into null), the token's own signature.
async function bearerCaller(request, token) {
  let session = null;
  try {
    session = await getMobileSession(request);
  } catch {
    session = null;
  }
  const payload = session ?? verifyToken(token);
  return toCaller(payload, 'bearer');
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
 * @returns {Promise<{ ok: true, caller: { role: string, id: number|string, email: string|null, via: 'cookie'|'bearer' } } | { ok: false, response: Response }>}
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
 * @returns {Promise<{ role: string, id: number|string, email: string|null, via: 'cookie'|'bearer' } | null>}
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
  } catch {
    fromQuery = null;
  }
  if (sameSecret(bearerToken(request), expected) || sameSecret(fromQuery, expected)) return { ok: true };
  return { ok: false, response: refusal(401, 'Unauthorized') };
}
