// database/fixtures/guard.js
// The fixture loader deletes every row of every table, so it first proves where it is (ADR-002).
// Nothing here can be switched off: no flag, variable or argument skips a check. A real need to load
// somewhere else is a change to this file, reviewed, not an override.
//
// Both functions throw an Error whose message starts with "REFUSED:"; the loader prints it and exits 1.

// Constants, not environment: a typo in a variable name or value can never widen what is allowed.
export const DEV_HOSTS = ['db', 'localhost', '127.0.0.1', '::1'];
export const DEV_DATABASE = 'workontap_db';

// Names reserved by RFC 2606 and RFC 6761: .test, .example, .invalid, .localhost and example.com/.net/.org
// (with any subdomains). Nothing sent to one can reach a mailbox. One pattern serves both sides: the
// loader passes SYNTHETIC_EMAIL.source to REGEXP_LIKE on the server, and the guard spec runs this RegExp.
export const SYNTHETIC_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)*(test|example|invalid|localhost|example\.(com|net|org))$/i;

// Every column that holds a person's email address. An address outside the reserved names in any of
// them means the database holds, or once held, a real person.
const PERSON_EMAIL_COLUMNS = [
  ['users', 'email'],
  ['service_providers', 'email'],
  ['bookings', 'customer_email'],
  ['deletion_requests', 'email'],
];

const refused = (reason) => new Error(`REFUSED: ${reason}`);

// Checks the very settings the connection will use, before it is made. Pure.
export function assertDevTarget({ host, port, database }) {
  if (!DEV_HOSTS.includes(host)) {
    throw refused(`host '${host}' is not a local dev host (${DEV_HOSTS.join(', ')})`);
  }
  if (database !== DEV_DATABASE) {
    throw refused(`database '${database}' is not '${DEV_DATABASE}'`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw refused(`port '${port}' is not a TCP port`);
  }
}

// Asks the server that answered, whatever it is, and reads counts only, never a row. A server that cannot
// be asked is refused too: the guard never passes by not knowing.
export async function assertNoRealPeople(connection) {
  for (const [table, column] of PERSON_EMAIL_COLUMNS) {
    let outside;
    try {
      const [[row]] = await connection.query(
        "SELECT COUNT(*) AS n FROM ?? WHERE NOT REGEXP_LIKE(??, ?, 'i')",
        [table, column, SYNTHETIC_EMAIL.source],
      );
      outside = Number(row.n);
    } catch (error) {
      throw refused(`could not count ${table}.${column} (${error.code || 'query failed'}), so the target cannot be shown to hold no real person`);
    }
    if (outside !== 0) {
      throw refused(`${table}.${column} holds ${outside} address(es) outside the reserved test names, so this database may hold real people`);
    }
  }
}
