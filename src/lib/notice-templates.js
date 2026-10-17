// src/lib/notice-templates.js
//
// What a notice may say (ENG-018, ADR-018). Pure: a kind and its values in, the words out. No database, no clock, no network, so a spec can check every
// word a customer, a provider, a cleaner or an admin can be sent without a stack.
//
// AN SMS IS THE WHOLE CONTRACT OF WHAT A TEXT MAY SAY (ADR-012): fixed ASCII words, a booking number (which the server made), a price, an absolute link
// and the numbers a route computed. No name, address, note or other typed text ever goes into one, so there is nothing a stranger can type into a form
// to make someone else's phone say. A text is at most SMS_BODY_MAX characters, one GSM-7 segment, and templateFor throws rather than return one that is
// not. An e-mail is plain text with a fixed subject carrying the booking number: the same facts plus the ones an e-mail can carry (the service, the
// date and slot). A greeting may carry a typed first name, but only after cleanLine has taken the line breaks and control characters out of it and cut it.
// The report's note and photo address, a customer's address or phone, and any card detail are in no template.
//
// NOTICE_KINDS -> the nine kinds, frozen. src/lib/notice-events.js has one function per kind and e2e/notices-pins.spec.js pins the two lists equal.
// SMS_BODY_MAX -> 160.
// NAME_MAX -> 60, the longest typed first name a greeting carries.
// cleanLine(text, max = NAME_MAX) -> one line: control characters, line and paragraph separators and the characters that reorder text are each a space,
//   runs of white space are one space, trimmed, cut to `max` characters (code points, so a pair is not split). A value that is not a string is ''.
// templateFor(kind, values) -> { sms, subject, text }. `sms` is the text message; `subject` and `text` are the e-mail, and both are null for a kind
//   that has no e-mail (job_link, job_started). A kind that is not one of NOTICE_KINDS, or a value that is missing or not valid, throws an Error whose
//   `code` is 'bad_notice_kind' or 'bad_notice_value' and whose message names the field and never the value. Values, by kind (n is the booking number,
//   url an absolute link made by appOrigin(), price a number of dollars):
//     quote_requested  { name?, service? }
//     card_link        { n, price, url, name?, service?, date?, slot? }
//     job_booked       { n, name?, service?, date?, slot?, visits? }
//     job_assigned     { n, service?, date?, slot?, url? }            url is the provider's jobs page, for the e-mail only
//     job_claimed      { audience: 'customer' | 'provider', n, name?, service?, date?, slot?, url? }
//     job_link         { n, url }
//     report_added     { n, label, url? }                               label is one of the five fixed report labels, never the note
//     job_started      { n, workers, hours, price }
//     job_finished     { n, guest?, hours?, name?, price?, service? }   guest: the wording of a booking with no account; hours: the sweep's window
//   `service`, `date` and `slot` are values the server read, shown only in an e-mail, and are passed through cleanLine all the same.

export const SMS_BODY_MAX = 160;
export const NAME_MAX = 60;
export const NOTICE_KINDS = Object.freeze(['quote_requested', 'card_link', 'job_booked', 'job_assigned', 'job_claimed', 'job_link', 'report_added', 'job_started', 'job_finished']);

const SUPPORT_ADDRESS = 'support@workontap.com';
// Characters that are not a space but break a line or reorder text: C0 and C1 controls, line and paragraph separators, zero-width marks and the
// bidirectional controls (a name that reads backwards inside a sentence is a way to make the sentence say something else).
const LINE_BREAKERS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'g');
// The longest values a text can hold and still fit one segment. A booking number is 'BK' and thirteen digits of time and up to three of a random
// number (18 characters); a link is an origin of up to 31 characters, '/card/' or '/job/' and the 43-character token. templateFor throws for a value
// beyond these and never cuts one: a link with a piece missing is worse than a text that was not sent.
const NUMBER_MAX = 20;
const URL_MAX = 80;
const PRICE_BELOW = 100_000;
const NUMBER_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${NUMBER_MAX}}$`);
const URL_PATTERN = /^https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const LABEL_PATTERN = /^[A-Za-z][A-Za-z ,.'-]{0,47}$/;
const BODY_PATTERN = /^[\x20-\x7E]+$/;
const LEFT_OVER = /undefined|NaN|null|[{}]|\[object/;

export function cleanLine(text, max = NAME_MAX) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(LINE_BREAKERS, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, max).join('').trim();
}

function bad(code, field) {
  return Object.assign(new Error(`notice ${field} is not valid`), { code });
}

function numberOf(values) {
  if (typeof values.n !== 'string' || !NUMBER_PATTERN.test(values.n)) throw bad('bad_notice_value', 'n');
  return values.n;
}

function urlOf(values, required) {
  if (values.url === undefined || values.url === null) {
    if (required) throw bad('bad_notice_value', 'url');
    return null;
  }
  if (typeof values.url !== 'string' || values.url.length > URL_MAX || !URL_PATTERN.test(values.url)) throw bad('bad_notice_value', 'url');
  return values.url;
}

function dollars(value, field) {
  const amount = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount >= PRICE_BELOW) throw bad('bad_notice_value', field);
  return amount.toFixed(2);
}

function wholeNumber(value, field, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw bad('bad_notice_value', field);
  return String(value);
}

// Hours the route parsed: 1, 1.5, 2.25. Rounded to two places so a float's tail never reaches a text.
function hoursOf(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999) throw bad('bad_notice_value', field);
  return String(Math.round(value * 100) / 100);
}

const greeting = (values) => {
  const name = cleanLine(values.name);
  return name === '' ? 'Hello,' : `Hi ${name},`;
};

// An optional "Label: value" line of an e-mail, or null (dropped by `body`) when there is no value.
function line(label, value) {
  const clean = cleanLine(value, 80);
  return clean === '' ? null : `${label}: ${clean}`;
}

function when(values) {
  const date = cleanLine(values.date, 40);
  const slot = cleanLine(values.slot, 40);
  if (date === '' && slot === '') return null;
  return `When: ${[date, slot].filter((part) => part !== '').join(' ')}`;
}

const body = (...parts) => `${parts.filter((part) => typeof part === 'string').join('\n')}\n`;

const BUILDERS = {
  quote_requested: (v) => ({
    sms: 'WorkOnTap: we got your quote request. We will email you your quote soon.',
    subject: 'We got your quote request',
    text: body(greeting(v), '', 'WorkOnTap got your request for a quote. We will email you your quote soon.', line('Service', v.service), '',
      'If you did not ask for a quote, you can ignore this message.'),
  }),

  card_link: (v) => {
    const n = numberOf(v);
    const price = dollars(v.price, 'price');
    const url = urlOf(v, true);
    return {
      sms: `WorkOnTap: quote for booking #${n} is $${price}. Add your card: ${url}`,
      subject: `Your quote for booking #${n}`,
      text: body(greeting(v), '', `A booking has been made for you with WorkOnTap (booking #${n}). Your quote is $${price}.`, line('Service', v.service), when(v), '',
        'Add your card to confirm the booking:', url, '', 'If you were not expecting this, you can ignore this message.'),
    };
  },

  job_booked: (v) => {
    const n = numberOf(v);
    const visits = v.visits === undefined ? null : wholeNumber(v.visits, 'visits', 400);
    return {
      sms: `WorkOnTap: booking #${n} is confirmed. We will tell you when a professional is assigned.`,
      subject: `Booking #${n} is confirmed`,
      text: body(greeting(v), '', `Your booking #${n} is confirmed.`, line('Service', v.service), when(v), visits !== null && visits !== '1' ? `Visits: ${visits}` : null, '',
        'We will tell you when a professional is assigned.'),
    };
  },

  job_assigned: (v) => {
    const n = numberOf(v);
    const url = urlOf(v, false);
    return {
      sms: `WorkOnTap: you have a new job, booking #${n}. Open the app for the details.`,
      subject: `New job: booking #${n}`,
      text: body(`You have a new job: booking #${n}.`, line('Service', v.service), when(v), '', 'Open the app for the details.', url),
    };
  },

  job_claimed: (v) => {
    const n = numberOf(v);
    const url = urlOf(v, false);
    if (v.audience === 'customer') {
      return {
        sms: `WorkOnTap: a professional has accepted your booking #${n}.`,
        subject: `A professional accepted booking #${n}`,
        text: body(greeting(v), '', `A professional has accepted your booking #${n}.`, line('Service', v.service), when(v)),
      };
    }
    if (v.audience === 'provider') {
      return {
        sms: `WorkOnTap: you accepted booking #${n}. Open the app for the details.`,
        subject: `You accepted booking #${n}`,
        text: body(`You accepted booking #${n}.`, line('Service', v.service), when(v), '', 'Open the app for the details.', url),
      };
    }
    throw bad('bad_notice_value', 'audience');
  },

  job_link: (v) => {
    const n = numberOf(v);
    const url = urlOf(v, true);
    return { sms: `WorkOnTap: job link #${n}: ${url} A code is texted when you open it.`, subject: null, text: null };
  },

  report_added: (v) => {
    const n = numberOf(v);
    if (typeof v.label !== 'string' || !LABEL_PATTERN.test(v.label)) throw bad('bad_notice_value', 'label');
    const url = urlOf(v, false);
    return {
      sms: `WorkOnTap: on-site report on booking #${n}: ${v.label}. Open Job Requests.`,
      subject: `On-site report on booking #${n}`,
      text: body(`An on-site report was added to booking #${n}: ${v.label}.`, '', 'Open Job Requests to read it and answer.', url),
    };
  },

  job_started: (v) => {
    const n = numberOf(v);
    const workers = wholeNumber(v.workers, 'workers', 999);
    const hours = hoursOf(v.hours, 'hours');
    const price = dollars(v.price, 'price');
    return { sms: `WorkOnTap: your professional has started booking #${n}. Professionals: ${workers}. Estimated time: ${hours} hrs. Price: $${price}.`, subject: null, text: null };
  },

  job_finished: (v) => {
    const n = numberOf(v);
    if (v.guest === true) {
      const hours = wholeNumber(v.hours, 'hours', 999);
      return {
        sms: `WorkOnTap: booking #${n} is finished. Your card on file is charged in ${hours} hours. Questions: ${SUPPORT_ADDRESS}`,
        subject: `Booking #${n} is finished`,
        text: body(greeting(v), '', `Your professional has finished booking #${n}.`, line('Service', v.service),
          `The card on file is charged in ${hours} hours. Questions: ${SUPPORT_ADDRESS}`),
      };
    }
    return {
      sms: `WorkOnTap: your invoice for booking #${n} is ready. Please approve and pay.`,
      subject: `Your invoice for booking #${n} is ready`,
      text: body(greeting(v), '', `Your professional has finished booking #${n} and your invoice is ready.`, line('Service', v.service),
        v.price === undefined ? null : `Price: $${dollars(v.price, 'price')}`, '', 'Please approve and pay.'),
    };
  },
};

export function templateFor(kind, values = {}) {
  if (typeof kind !== 'string' || !Object.hasOwn(BUILDERS, kind)) throw bad('bad_notice_kind', 'kind');
  const made = BUILDERS[kind](values ?? {});
  // The last line of defence: whatever a builder did, a text that leaves here is printable ASCII, one segment, and says nothing it was not given.
  if (typeof made.sms !== 'string' || !BODY_PATTERN.test(made.sms) || made.sms.length > SMS_BODY_MAX) throw bad('bad_notice_value', 'sms');
  // A link is random letters and digits that may spell "NaN" or "null" by chance (about one token in 6,000 holds "NaN"), so it is taken out first.
  const link = typeof values?.url === 'string' ? values.url : '';
  if (LEFT_OVER.test(link === '' ? made.sms : made.sms.split(link).join(''))) throw bad('bad_notice_value', 'sms');
  return { sms: made.sms, subject: made.subject ?? null, text: made.text ?? null };
}
