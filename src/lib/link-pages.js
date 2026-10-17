// src/lib/link-pages.js
//
// The two pages whose address is a credential (ENG-018 design, Interfaces 8; ENG-015 F2, ENG-016 F7, ENG-013 F1): /job/{token}, which opens a job for the
// people the link was texted to, and /card/{token}, where a customer adds a card for a booking. Whatever script runs on such a page can read its address,
// and the site-wide scripts (the ones an admin pastes into seo_settings, and the four third-party tags in src/app/layout.js) are not ones anyone has
// reviewed against that. So a link page runs none of them, and src/middleware.js answers it with a Content-Security-Policy that names what it may load.
//
// The file is pure and imports nothing, because the Edge middleware and the root layout both import it and a spec loads it in plain Node.
//
// LINK_PAGE_PREFIXES -> '/job/' and '/card/'. A path is a link page when it starts with one and has something after it.
// linkPageKind(pathname) -> 'job', 'card' or null. The path is decoded once and lower-cased first, so '/%6Aob/x' is not a way round the exclusion; a path
//   that cannot be decoded is read as it is.
// linkPagePolicy(kind, nonce, { production }) -> the header value. One line, directives joined by '; ', and the nonce is in script-src, where Next looks
//   for it to put on its own inline scripts. 'unsafe-eval' is added outside production only, for the dev server's refresh. The card page adds Stripe's
//   script, API and frame origins and nothing else; the job page loads no frame at all.

const KIND_OF_PREFIX = { '/job/': 'job', '/card/': 'card' };
export const LINK_PAGE_PREFIXES = Object.keys(KIND_OF_PREFIX);

export function linkPageKind(pathname) {
  let path = typeof pathname === 'string' ? pathname : '';
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not a valid escape: read the path as it came.
  }
  path = path.toLowerCase();
  for (const prefix of LINK_PAGE_PREFIXES) {
    if (path.startsWith(prefix) && path.length > prefix.length) return KIND_OF_PREFIX[prefix];
  }
  return null;
}

export function linkPagePolicy(kind, nonce, { production = true } = {}) {
  const card = kind === 'card';
  const scripts = ["'self'", `'nonce-${nonce}'`];
  if (card) scripts.push('https://js.stripe.com');
  if (!production) scripts.push("'unsafe-eval'");
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    card ? "connect-src 'self' https://api.stripe.com" : "connect-src 'self'",
    card ? 'frame-src https://js.stripe.com https://hooks.stripe.com' : "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
