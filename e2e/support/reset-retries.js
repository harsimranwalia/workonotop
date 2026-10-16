import { RESET_RETRIES } from './auth.js';

const SENDERS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']);

// The dev server closes a connection that has sat unused for about six seconds, and Playwright's request client keeps its connections for the next
// request context to use. A case that drives the page for longer than that and then sends the first request of the next case can write it to a
// connection the server is closing: the server never reads it, the app logs nothing, and the call ends in "socket hang up" (ECONNRESET) with no
// answer (BUG-018 and BUG-019). A second try goes out on a new connection.
//
// `request` with Playwright's own maxRetries (RESET_RETRIES, as support/auth.js uses it) on every call that does not name its own. It sends a call
// again only on ECONNRESET: an answer, a refused connection and a timeout come back as they are, and the config's retries: 0 holds for the cases.
// A write the server had already acted on would be sent twice and answer with a refusal the case reads as its own failure, so use it where the
// target is the dev app and its database (the specs that use it assert that first).
/**
 * @template {import('@playwright/test').APIRequestContext} T
 * @param {T} request
 * @returns {T}
 */
export function resendingOnReset(request) {
    return new Proxy(request, {
        get(target, name) {
            const member = Reflect.get(target, name);
            if (typeof member !== 'function') return member;
            if (!SENDERS.has(String(name))) return member.bind(target);
            return (url, options) => member.call(target, url, { maxRetries: RESET_RETRIES, ...options });
        },
    });
}
