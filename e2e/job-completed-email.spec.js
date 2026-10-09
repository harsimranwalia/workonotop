// @ts-check
// The customer's job-completed e-mail is composed by src/lib/job-completed-email.js, which escapes every value it places in the HTML
// (ENG-006, cases 5 to 8). Four cases, each titled for what it shows:
//   5  the provider's summary and recommendations show as the text that was entered, each line break (LF, CRLF or CR) as one <br>;
//   6  the customer's name, the provider's name, the service, the booking number, the photo addresses and the two links show as text;
//   7  unicode and a 10,000-character summary come through whole, and an empty summary shows "Job completed successfully.";
//   8  the job-finish route composes the e-mail with the module and holds no template of its own (a source read of the route).
// Cases 5 to 7 run in plain Node, with no browser, no app request and no database. The module has no imports, so each case loads it with
// a dynamic import(), as the other module specs do, and composes the e-mail from values that carry <a href="https://example.test">x</a>,
// <script>, <b>, ", ', &, "><img src=x>, line breaks, emoji, right-to-left text and a 10,000-character summary. They check the entities and
// the <br> in the HTML, and that none of <a href="https://example.test", <script, <b> and "><img occurs in it. The e-mail's own markup
// holds none of the four (each case composes it from plain values first), so one in the HTML came from a value.
// Case 8 reads the route as text, with its comments taken out as e2e/cron-secret.spec.js does, so a call that is only in a comment does not count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROUTE = 'src/app/api/provider/jobs/time-tracking/route.js';

/** @type {typeof import('../src/lib/job-completed-email.js')} */
let email;

// Cases 5 to 7 each load the module when they start, so a missing module fails those three one by one and case 8 still reads the route.
async function loadEmail() {
    email = await import('../src/lib/job-completed-email.js');
}

// Plain values for every field, so that a case changes only the fields it is about.
const PLAIN = {
    customerName: 'Casey',
    providerName: 'Pat Provider',
    serviceName: 'Window cleaning',
    bookingNumber: 'WOT-1042',
    startTime: '2026-10-07T09:00:00Z',
    finishedAt: new Date('2026-10-07T11:30:00Z'),
    totalMinutes: 150,
    overtimeMinutes: 30,
    price: 149.5,
    workSummary: 'Cleaned every window.',
    recommendations: 'Book a gutter check.',
    beforePhotos: ['/uploads/before-1.jpg'],
    afterPhotos: ['https://cdn.example.test/after-1.jpg'],
    baseUrl: 'http://localhost:3000',
    bookingId: 42,
};

/** The e-mail's HTML, composed from the plain values with the given fields changed. */
const compose = (fields = {}) => email.jobCompletedEmailHtml({ ...PLAIN, ...fields });

const count = (text, part) => text.split(part).length - 1;

// None of these is in the e-mail's own markup (each case checks the plain e-mail for them first), so one in the HTML came from a value.
const MARKUP = ['<a href="https://example.test"', '<script', '<b>', '"><img'];

function expectNoMarkup(html, what) {
    for (const markup of MARKUP) expect(html.includes(markup), `${what}: the HTML holds no ${markup}`).toBe(false);
}

function expectShown(html, text, what) {
    const named = text.length > 80 ? `${text.slice(0, 80)}...` : text;
    expect(html.includes(text), `${what}: the HTML holds ${JSON.stringify(named)}`).toBe(true);
}

// The summary and the recommendations: markup, quotes, an ampersand, and one line break of each kind (LF, CRLF, CR), then doubled ones.
const SUMMARY = 'Cleaned <b>every</b> window & "frame".\nSecond: it\'s <script>alert(1)</script>.\r\nThird: <a href="https://example.test">x</a>.\rFourth: "><img src=x>';
const SUMMARY_SHOWN = 'Cleaned &lt;b&gt;every&lt;/b&gt; window &amp; &quot;frame&quot;.<br>Second: it&#39;s &lt;script&gt;alert(1)&lt;/script&gt;.<br>Third: &lt;a href=&quot;https://example.test&quot;&gt;x&lt;/a&gt;.<br>Fourth: &quot;&gt;&lt;img src=x&gt;';
const RECOMMENDATIONS = 'Replace the seal <b>soon</b>.\n\nTreat the frame & "sill" at \'dusk\'\r\n\r\n<script>';
const RECOMMENDATIONS_SHOWN = 'Replace the seal &lt;b&gt;soon&lt;/b&gt;.<br><br>Treat the frame &amp; &quot;sill&quot; at &#39;dusk&#39;<br><br>&lt;script&gt;';

test("the job-completed e-mail shows the provider's summary and recommendations as plain text with their line breaks", async () => {
    await loadEmail();
    expectNoMarkup(compose(), 'the e-mail composed from plain values');

    const html = compose({ workSummary: SUMMARY, recommendations: RECOMMENDATIONS });
    expectShown(html, SUMMARY_SHOWN, 'the summary, escaped, with one <br> for its LF, its CRLF and its CR');
    expectShown(html, RECOMMENDATIONS_SHOWN, 'the recommendations, escaped, with one <br> for each of its four breaks');
    expect(count(html, '<br>') - count(compose(), '<br>'), 'the <br> the two texts add: 3 and 4').toBe(7);
    expectNoMarkup(html, 'the summary and the recommendations');

    // The same through the helper the module exports for these two values.
    expect(email.textAsHtml('a\nb\r\nc\rd'), 'LF, CRLF and CR are one <br> each').toBe('a<br>b<br>c<br>d');
    expect(email.textAsHtml('<b>&</b>\n'), 'the text is escaped, then broken into lines').toBe('&lt;b&gt;&amp;&lt;/b&gt;<br>');
    expect(email.textAsHtml(null) + email.textAsHtml(undefined), 'no text is no output').toBe('');
});

test('the job-completed e-mail shows names, the service, photo addresses and links as plain text', async () => {
    await loadEmail();
    expectNoMarkup(compose(), 'the e-mail composed from plain values');

    const html = compose({
        customerName: `Sam <b>the</b> O'Neil & "Co"`,
        providerName: '<a href="https://example.test">x</a>',
        serviceName: "<script>alert('s')</script>",
        bookingNumber: '"><img src=x>',
        beforePhotos: ['https://example.test/a.jpg" onerror="alert(1)', '"><img src=x>'],
        afterPhotos: ["/uploads/it's <b>.jpg", 'https://example.test/p.jpg?a=1&b=2'],
    });
    expectShown(html, 'Sam &lt;b&gt;the&lt;/b&gt; O&#39;Neil &amp; &quot;Co&quot;', "the customer's name");
    expectShown(html, '&lt;a href=&quot;https://example.test&quot;&gt;x&lt;/a&gt;', "the provider's name");
    expectShown(html, '&lt;script&gt;alert(&#39;s&#39;)&lt;/script&gt;', 'the service');
    expectShown(html, '&quot;&gt;&lt;img src=x&gt;', 'the booking number');
    // A photo address is shown whole inside its src attribute (a relative one after the base address), and its quotes close nothing.
    const photoSources = [
        'https://example.test/a.jpg&quot; onerror=&quot;alert(1)',
        'http://localhost:3000&quot;&gt;&lt;img src=x&gt;',
        'http://localhost:3000/uploads/it&#39;s &lt;b&gt;.jpg',
        'https://example.test/p.jpg?a=1&amp;b=2',
    ];
    for (const shown of photoSources) expectShown(html, `src="${shown}"`, 'a photo address');
    expect(html.includes('" onerror="'), 'no attribute is added to a photo').toBe(false);
    expectNoMarkup(html, 'the names, the service, the booking number and the photo addresses');

    // Each link is the base address, /my-bookings/ and the booking's id, escaped as one value.
    expectShown(compose(), 'href="http://localhost:3000/my-bookings/42?action=approve"', 'the approve link');
    expectShown(compose(), 'href="http://localhost:3000/my-bookings/42?action=dispute"', 'the dispute link');
    const linked = compose({ baseUrl: 'https://app.example.test/<b>', bookingId: '7&x="><img src=x>', beforePhotos: [], afterPhotos: [] });
    const target = 'https://app.example.test/&lt;b&gt;/my-bookings/7&amp;x=&quot;&gt;&lt;img src=x&gt;';
    expectShown(linked, `href="${target}?action=approve"`, 'the approve link with markup in its parts');
    expectShown(linked, `href="${target}?action=dispute"`, 'the dispute link with markup in its parts');
    expectNoMarkup(linked, 'the links');

    // The helper the module exports for these values.
    expect(email.escapeHtml(`&<>"'`), 'the five characters, & first').toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(email.escapeHtml('&lt;b&gt;'), 'text that looks like an entity is shown as it was entered').toBe('&amp;lt;b&amp;gt;');
    expect(email.escapeHtml(null) + email.escapeHtml(undefined), 'null and undefined are no output').toBe('');
    expect(`${email.escapeHtml(0)}|${email.escapeHtml(42)}|${email.escapeHtml(false)}`, 'other values are shown as their text').toBe('0|42|false');
});

// Unicode: an emoji of four code points (woman, skin tone, joiner, wrench), right-to-left text, and markup among them.
const WORKER = '\u{1F469}\u{1F3FD}\u{200D}\u{1F527}';
const ARABIC = 'مرحبا بالعالم';
const HEBREW = 'שלום עולם';
const UNICODE = `Café ☕ <b>日本語</b> ${WORKER} 🚿 ${ARABIC} ${HEBREW} "q" & 's' <script>`;
const UNICODE_SHOWN = `Café ☕ &lt;b&gt;日本語&lt;/b&gt; ${WORKER} 🚿 ${ARABIC} ${HEBREW} &quot;q&quot; &amp; &#39;s&#39; &lt;script&gt;`;
// 10,000 characters each: digits only, and a block with markup characters and a line break, repeated.
const LONG = '0123456789'.repeat(1000);
const LONG_MIXED = 'a <b> & "c" \'d\'\n'.repeat(625);
const LONG_MIXED_SHOWN = 'a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;<br>'.repeat(625);

test('the job-completed e-mail keeps unicode and long text whole and shows the default line for an empty summary', async () => {
    await loadEmail();
    expectNoMarkup(compose(), 'the e-mail composed from plain values');

    const html = compose({
        customerName: 'Zoë 🌟',
        providerName: 'Jörg Müller-Łukasiewicz',
        serviceName: 'تنظيف النوافذ',
        bookingNumber: 'שלום-42',
        workSummary: UNICODE,
    });
    for (const text of ['Zoë 🌟', 'Jörg Müller-Łukasiewicz', 'تنظيف النوافذ', 'שלום-42', UNICODE_SHOWN]) expectShown(html, text, 'unicode text');
    expectNoMarkup(html, 'unicode text with markup among it');

    // No cap and no strip: all 10,000 characters of each text arrive, and the summary adds its own length and nothing else.
    expect(LONG.length, 'the long summary is 10,000 characters').toBe(10000);
    expect(LONG_MIXED.length, 'the long recommendations text is 10,000 characters').toBe(10000);
    const long = compose({ workSummary: LONG, recommendations: LONG_MIXED });
    expectShown(long, LONG, 'a 10,000-character summary');
    expectShown(long, LONG_MIXED_SHOWN, 'a 10,000-character recommendations text with markup characters and line breaks');
    expectNoMarkup(long, 'the long texts');
    expect(compose({ workSummary: LONG }).length - compose({ workSummary: 'x' }).length, 'the summary adds its own length').toBe(LONG.length - 1);
    expectShown(compose({ workSummary: '  padded\ttext  ' }), '  padded\ttext  ', 'spaces and a tab');

    // An empty summary shows the default line; an empty recommendations text shows no recommendations block.
    for (const [named, empty] of [['an empty string', ''], ['null', null], ['undefined', undefined]]) {
        expectShown(compose({ workSummary: empty }), 'Job completed successfully.', `a summary of ${named}`);
        expect(compose({ recommendations: empty }).includes('Recommendations'), `a recommendations text of ${named} has no block`).toBe(false);
    }
    expect(compose().includes('Job completed successfully.'), 'a summary that was entered is shown, not the default line').toBe(false);
    expect(compose().includes('Recommendations'), 'a recommendations text that was entered has its block').toBe(true);
});

/**
 * The text with its comments taken out and nothing else changed, so a call that exists only in a comment does not count (the reader
 * of e2e/cron-secret.spec.js). One pass over the characters: a `//` comment goes up to its line break, a block comment becomes one
 * space plus the line feeds it held, and a '...', "..." or `...` string is copied whole, a backslash escaping the character after it.
 * Limits: regex literals and `${ }` are not tracked. The route has no regex literal; its one template inside a `${ }` (the `text:`
 * part of the message) opens and closes its backticks in pairs, so the strings after it are read as they are written.
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (text.startsWith('//', i)) {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        } else if (text.startsWith('/*', i)) {
            const close = text.indexOf('*/', i + 2);
            const end = close === -1 ? text.length : close + 2;
            out += ' ' + text.slice(i, end).replace(/[^\n]/g, '');
            i = end;
        } else if (ch === "'" || ch === '"' || ch === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j + 1;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

test("the job-finish route composes the customer's e-mail with src/lib/job-completed-email.js", () => {
    const source = stripComments(fs.readFileSync(path.join(ROOT, ROUTE), 'utf8'));
    expect(source, 'the module is imported from @/lib/job-completed-email').toMatch(/import\s*\{\s*jobCompletedEmailHtml\s*\}\s*from\s*['"]@\/lib\/job-completed-email['"]/);
    expect(source, 'emailHtml is what the module composes').toMatch(/const\s+emailHtml\s*=\s*jobCompletedEmailHtml\s*\(/);
    expect(source, 'the message sends emailHtml as its html').toMatch(/\bhtml:\s*emailHtml\b/);
    expect(source, "the links carry the booking row's own id").toMatch(/\bbookingId:\s*booking\.id\b/);

    // Two lines of the route carry the summary and the recommendations in a template and are not HTML: the `text:` part of the
    // message, and the notes bound to the booking_status_history INSERT. Every other line that does is an HTML template of the route's own.
    const mentions = source.split('\n').filter((line) => line.includes('${work_summary') || line.includes('${recommendations'));
    const plainTextPart = /^\s*text:\s*`/;
    const historyNotes = /^\s*\[\s*booking_id\s*,\s*`Summary:/;
    expect(mentions.filter((line) => plainTextPart.test(line)).length, 'the plain-text part of the message is one text: line').toBe(1);
    expect(mentions.filter((line) => !plainTextPart.test(line) && !historyNotes.test(line)), 'no other line interpolates the summary or the recommendations').toEqual([]);
});
