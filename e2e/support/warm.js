import { test } from '@playwright/test';
import { RESET_RETRIES } from './auth.js';

// `next dev` compiles a page or an API route when it is first asked for, and again after about a minute without a request; on this host that
// takes 6 to 17 s a route, and much longer for several routes on an app that has been up for hours. A case that gives its first request 10 s
// to settle (a redirect, the page's own 10 s abort of its live price) or 30 s (Playwright's default on a request) cannot absorb that. This asks
// the dev server for each path once, in order, so the compile has been paid before the part of the case that has a budget.
//
// It asserts nothing. Any answer counts (401, 404, 405, a redirect, even a 500 from a route that will not compile): the answer comes after the
// compile, and a route that cannot answer GET is compiled by the request all the same. The call is sent again only when the connection it was
// written to was closed before an answer (RESET_RETRIES, as support/auth.js uses it), which is safe because a warm-up GET writes nothing.
//   await warm(request, ['/api/provider/me', '/provider/login']);   // paths no cookie guards
//   await warm(page.request, ['/admin/jobs']);                       // an /admin page: after signInAs, so the request carries the cookie
//
// Never list a path whose GET writes (the job timer's records the look). A dynamic segment takes any value. A route is dropped about a minute
// after its last request, so call this just before the step and not once per file or per run. A list is found by running the case cold and
// reading `Compiling` in test-results/app.log: no `Compiling` line may follow the last warm-up request. Routes asked for together compile together and
// log one `Compiling` line for the lot, so also check that every path asked for after the last warm-up request was served before it. A case that later
// visits a route that is not in its list behaves as it did before, so it can flake again and it cannot pass for a reason it did not earn.
/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string[]} paths
 * @param {{ timeout?: number }} [options]
 */
export async function warm(request, paths, { timeout = 90_000 } = {}) {
    const seen = [];
    for (const path of paths) {
        const from = Date.now();
        let response;
        try {
            response = await request.get(path, { timeout, maxRedirects: 0, maxRetries: RESET_RETRIES });
        } catch (error) {
            throw new Error(`warm-up: GET ${path} got no answer within ${timeout / 1000} s (${String(error?.message ?? error).split('\n')[0]})`);
        }
        seen.push(`${path} ${response.status()} ${((Date.now() - from) / 1000).toFixed(1)} s`);
    }
    // Shows in results.json which route took how long; a 3xx on an /admin path says the cookie did not travel and the page was not compiled.
    test.info().annotations.push({ type: 'warm-up', description: seen.join('; ') });
}
