// src/lib/link-token.js
//
// The one place a link's token is made and its hash is taken (ENG-015 design, Interfaces 1). A token is 32 random bytes as base64url: 43
// characters, no padding. Two kinds of link use it: the card link of an admin's booking (src/lib/booking-card.js, which stores only the hash) and
// the job link (src/lib/job-link.js, which stores the token itself, because a job link is a locator and opens nothing without a sign-in).
//
// The file imports only node:crypto, so a spec and any other library can load it in plain Node, and a case pins that.
//
// LINK_TOKEN_PATTERN: what a token looks like. Anything else is not a token and is refused before the database is read.
// newLinkToken() -> a new token. It is the only source of one; nothing derives a token from an id, a number or an address.
// sha256Hex(text) -> the 64-character hex SHA-256 of the text. Codes, sessions and counters are stored as this and never as the value.
import { createHash, randomBytes } from 'node:crypto';

export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newLinkToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}
