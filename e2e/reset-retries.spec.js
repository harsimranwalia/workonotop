// @ts-check
// BUG-019: the helper of e2e/support/reset-retries.js, against a server that closes a connection before it answers. No app, no database, no browser:
// a local server on a free port stands in for the dev server. A connection it destroys after reading a request is what the dev server's idle
// timeout does to a request written to a connection it is closing, and the call ends the way the red of BUG-019 did, in "socket hang up"
// (ECONNRESET) with no answer. That is the one thing the helper sends again, so the cases below produce it at will and say what the helper does
// with it and what it leaves alone. Each title starts with "Reset:", and the file's name, the describe and the title together are its baseline key.
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { RESET_RETRIES } from './support/auth.js';
import { resendingOnReset } from './support/reset-retries.js';

/**
 * A local server that reads each request and destroys the connection of the first `drops` of them without an answer; every later request is
 * answered `status` with { ok: true }. `seen` holds the body of every request it read, in order.
 * @param {number} drops
 * @param {number} [status]
 */
async function serve(drops, status = 200) {
    /** @type {string[]} */
    const seen = [];
    const server = http.createServer((req, res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            seen.push(Buffer.concat(chunks).toString('utf8'));
            if (seen.length <= drops) {
                req.socket.destroy();
                return;
            }
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    const stop = async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve(undefined)));
    };
    return { base: `http://127.0.0.1:${port}`, seen, stop };
}

test.describe('Reset retries: a connection the server closes before it answers', () => {
    test('Reset: a call that names no retries ends in "socket hang up" and the server read it once', async ({ playwright }) => {
        const target = await serve(1);
        const request = await playwright.request.newContext({ baseURL: target.base });
        try {
            await expect(request.post('/write', { data: { n: 1 } })).rejects.toThrow(/socket hang up/);
            expect(target.seen).toEqual(['{"n":1}']);
        } finally {
            await request.dispose();
            await target.stop();
        }
    });

    test('Reset: through the helper the same call is sent again on a new connection, its answer comes back, and the server read the body twice', async ({ playwright }) => {
        const target = await serve(1);
        const plain = await playwright.request.newContext({ baseURL: target.base });
        const request = resendingOnReset(plain);
        try {
            const response = await request.post('/write', { data: { n: 1 } });
            expect(response.status()).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
            expect(target.seen).toEqual(['{"n":1}', '{"n":1}']);
        } finally {
            await plain.dispose();
            await target.stop();
        }
    });

    test('Reset: a server that closes every connection fails the call after RESET_RETRIES more tries, and the error says how many were made', async ({ playwright }) => {
        const target = await serve(Infinity);
        const plain = await playwright.request.newContext({ baseURL: target.base });
        const request = resendingOnReset(plain);
        try {
            await expect(request.get('/read')).rejects.toThrow(new RegExp(`Failed after ${RESET_RETRIES + 1} attempt`));
            expect(target.seen.length).toBe(RESET_RETRIES + 1);
        } finally {
            await plain.dispose();
            await target.stop();
        }
    });

    test('Reset: an answer comes back as it is, a 500 included, and is not sent again', async ({ playwright }) => {
        const target = await serve(0, 500);
        const plain = await playwright.request.newContext({ baseURL: target.base });
        const request = resendingOnReset(plain);
        try {
            const response = await request.post('/write', { data: { n: 2 } });
            expect(response.status()).toBe(500);
            expect(target.seen).toEqual(['{"n":2}']);
        } finally {
            await plain.dispose();
            await target.stop();
        }
    });

    test('Reset: a call that names its own maxRetries keeps it', async ({ playwright }) => {
        const target = await serve(1);
        const plain = await playwright.request.newContext({ baseURL: target.base });
        const request = resendingOnReset(plain);
        try {
            await expect(request.post('/write', { data: { n: 3 }, maxRetries: 0 })).rejects.toThrow(/socket hang up/);
            expect(target.seen).toEqual(['{"n":3}']);
        } finally {
            await plain.dispose();
            await target.stop();
        }
    });
});
