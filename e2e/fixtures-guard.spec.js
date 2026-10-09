// @ts-check
// The fixture loader deletes every row it can reach, so its guard has to refuse everything but the local
// dev database. These cases need no browser and no database: the guard is pure, and the one function that
// asks a server is given a stand-in for the server.
import { test, expect } from '@playwright/test';
import { assertDevTarget, assertNoRealPeople, DEV_DATABASE, DEV_HOSTS, SYNTHETIC_EMAIL } from '../database/fixtures/guard.js';

const dev = { host: 'db', port: 3306, database: DEV_DATABASE };

// The hosts the guard may accept, written out here and not read from the guard. A case that loops over
// DEV_HOSTS passes whatever DEV_HOSTS holds, so dropping a host from the guard would only shrink the spec.
const LOCAL_HOSTS = ['db', 'localhost', '127.0.0.1', '::1'];

// A server whose person tables hold a real address only in the given table.column pairs.
// It records every query, so a case can check what the guard asked.
function serverWithRealPeopleIn(pairs, failure) {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            calls.push({ sql, params });
            if (failure) throw failure;
            const [table, column] = params;
            const outside = pairs.some(([t, c]) => t === table && c === column) ? 1 : 0;
            return [[{ n: outside }], []];
        },
    };
}

test.describe('Fixture guard - the target', () => {

    for (const host of LOCAL_HOSTS) {
        test(`accepts the local host ${host}`, () => {
            expect(() => assertDevTarget({ ...dev, host })).not.toThrow();
        });
    }

    // Adding a host to the guard has to change this spec too, so the widening shows in review; removing one
    // already fails the accept case above.
    test('allows exactly the local hosts listed in this spec, no more and no fewer', () => {
        expect([...DEV_HOSTS].sort()).toEqual([...LOCAL_HOSTS].sort());
    });

    for (const host of ['db.example.com', 'prod-db.workontap.com', 'localhost.evil.test', 'DB', 'localhost ', '127.0.0.2', '0.0.0.0', '', undefined]) {
        test(`refuses the host ${JSON.stringify(host)}`, () => {
            expect(() => assertDevTarget({ ...dev, host })).toThrow(/^REFUSED: host/);
        });
    }

    for (const database of ['other', 'workontap_db_prod', 'WORKONTAP_DB', '', undefined]) {
        test(`refuses the database ${JSON.stringify(database)}`, () => {
            expect(() => assertDevTarget({ ...dev, database })).toThrow(/^REFUSED: database/);
        });
    }

    for (const port of [NaN, 0, 65536, 3306.5, undefined]) {
        test(`refuses the port ${port}`, () => {
            expect(() => assertDevTarget({ ...dev, port })).toThrow(/^REFUSED: port/);
        });
    }

    test('accepts the dev stack as it is configured, on its published port too', () => {
        expect(() => assertDevTarget({ host: '127.0.0.1', port: 3307, database: DEV_DATABASE })).not.toThrow();
    });
});

test.describe('Fixture guard - reserved email names', () => {

    const reserved = [
        'fixture-customer-1@workontap.test', 'FIXTURE-ADMIN-1@WORKONTAP.TEST', 'e2e-signup-ab12@workontap.test',
        'a@example.com', 'a@example.net', 'a@example.org', 'a@mail.example.org', 'a@host.invalid',
        'a@something.localhost', 'a@localhost', 'a@foo.example',
    ];
    const real = [
        'someone@gmail.com', 'someone@workontap.com', 'someone@test.com', 'someone@example.com.au',
        'someone@notexample.com', 'someone@example.org.evil.com', 'someone@x.test.com', 'someone@yahoo.ca',
        '', 'plainaddress', 'a@b@c.test', 'a@x.test ',
    ];

    for (const email of reserved) {
        test(`treats ${JSON.stringify(email)} as a reserved name`, () => {
            expect(SYNTHETIC_EMAIL.test(email)).toBe(true);
        });
    }

    for (const email of real) {
        test(`does not treat ${JSON.stringify(email)} as a reserved name`, () => {
            expect(SYNTHETIC_EMAIL.test(email)).toBe(false);
        });
    }
});

test.describe('Fixture guard - the server that answers', () => {

    // The columns the guard counts, in the order it counts them, written out here: the guard does not export
    // its list, and a case that read it would pass whatever it held.
    const COUNTED = [['users', 'email'], ['service_providers', 'email'], ['bookings', 'customer_email'], ['deletion_requests', 'email']];

    test('passes a server whose person tables hold only reserved names', async () => {
        await expect(assertNoRealPeople(serverWithRealPeopleIn([]))).resolves.toBeUndefined();
    });

    for (const [table, column] of COUNTED) {
        test(`refuses a server with a real address in ${table}.${column}`, async () => {
            await expect(assertNoRealPeople(serverWithRealPeopleIn([[table, column]]))).rejects.toThrow(`REFUSED: ${table}.${column} holds 1 address(es)`);
        });
    }

    test('refuses a server it cannot count, rather than passing it', async () => {
        const unreachable = serverWithRealPeopleIn([], Object.assign(new Error('boom'), { code: 'ER_NO_SUCH_TABLE' }));
        await expect(assertNoRealPeople(unreachable)).rejects.toThrow(/^REFUSED: could not count users\.email \(ER_NO_SUCH_TABLE\)/);
    });

    // The stand-in answers by table and column whatever the WHERE says, so this is the one case that sees the
    // statement itself. Without it a predicate that matches nothing (WHERE 0), or one with its NOT dropped, passes
    // every case in this file.
    test('reads counts only and hands the server the same pattern the JS side tests', async () => {
        const server = serverWithRealPeopleIn([]);
        await assertNoRealPeople(server);
        expect(server.calls).toHaveLength(COUNTED.length);
        COUNTED.forEach(([table, column], i) => {
            expect(server.calls[i].sql).toBe("SELECT COUNT(*) AS n FROM ?? WHERE NOT REGEXP_LIKE(??, ?, 'i')");
            expect(server.calls[i].params).toEqual([table, column, SYNTHETIC_EMAIL.source]);
        });
    });
});
