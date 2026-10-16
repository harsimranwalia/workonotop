// src/lib/phone.js
//
// The one place a mobile number is read and shown (ENG-014 design, Interfaces 1). A number a person types becomes E.164 ('+14035550123') or
// is refused with a message to show them; nothing else is ever stored. The only SMS helper in the app, src/lib/sms.js, texts a bare ten-digit
// number to India, so a number that is guessed at is a text to a stranger: this file never guesses. A number that starts with + goes
// through that helper untouched, which is why every number stored here does. ENG-015 fixes the helper with this function, so the rule
// lives here and nowhere else.
//
// The file has no imports, so a spec and the SMS helper can load it in plain Node.
//
// normalisePhone(input) -> { ok: true, phone } | { ok: false, message }
//   A North American number: ten digits, eleven starting 1, or +1 and ten, with any spaces, dashes, dots and brackets between the digits. The
//   area code and the three digits after it each start with 2 to 9. It gives '+1AAABBBCCCC'.
//   Any other country: only with an explicit +, no 0 straight after it, 8 to 15 digits in all.
//   Refused: letters and extensions ('x123'), a + anywhere but the front, a number with no + and any other length (the message asks for the
//   country code), a +1 number that is not eleven digits, and anything over 40 characters as typed.
// formatPhone(e164) -> the number as a person reads it: '(403) 555-0123' for a North American number, the stored form for any other.
// canText(e164) -> true only for '+1' and ten digits whose area code is in CANADIAN_AREA_CODES. This is the destination rule (ENG-015, ADR-012):
//   src/lib/sms.js asks it before anything is sent, so a number is texted only when it is Canadian, and a number that is not (a toll or premium
//   code, a Caribbean or US number, another country) is never paid to reach. It is an allow-list, so a new overlay fails closed until one line
//   is added to the set below.
//
// The set was checked against the Canadian assignments on 2026-10-15 (Wikipedia's tables of area codes in Canada, which match the CRTC's
// decisions and the Canadian Numbering Administrator's relief documents; the CRTC and CNAC sites refused the fetch). It holds the 55 codes in
// service and 273, which the CRTC ordered for eastern Quebec on 2025-10-10 (Telecom Decision 2025-269, NANPA Planning Letter 632) to start on
// 2027-02-27. Left out on purpose until they are ordered or live: 851 (Nova Scotia and PEI, planned for 2028-05-27, still at the CRTC's
// consultation) and 568 (Alberta, only set aside).

const MAX_TYPED = 40;

export const PHONE_HINT = "A North American number like (403) 555-0123, or another country's number with a + and its country code, like +44 20 7946 0958.";

// What a person may put between the digits: spaces (a no-break space comes with a paste from a web page), dashes, dots and brackets.
const SEPARATORS = /[  ().-]/g;

const NORTH_AMERICAN = /^([2-9]\d{2})([2-9]\d{2})(\d{4})$/;

function refuse(message) {
  return { ok: false, message };
}

// `national` is the ten digits after the country code.
function northAmerican(national) {
  if (!NORTH_AMERICAN.test(national)) {
    return refuse('A North American number is ten digits, and the area code and the three digits after it cannot start with 0 or 1.');
  }
  return { ok: true, phone: `+1${national}` };
}

export function normalisePhone(input) {
  if (typeof input !== 'string' || input.trim() === '') return refuse("Enter the cleaner's mobile number.");
  if (input.length > MAX_TYPED) return refuse(`That number is too long. ${PHONE_HINT}`);

  const cleaned = input.trim().replace(SEPARATORS, '');
  if (!/^\+?\d+$/.test(cleaned)) {
    return refuse(`A number can have digits, spaces, dashes, dots and brackets, and a + at the front. It cannot have letters or an extension. ${PHONE_HINT}`);
  }

  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) return northAmerican(cleaned);
    if (cleaned.length === 11 && cleaned.startsWith('1')) return northAmerican(cleaned.slice(1));
    return refuse('A number with no + must be ten digits, or eleven starting with 1. For any other country, start with + and the country code, like +44 20 7946 0958.');
  }

  const digits = cleaned.slice(1);
  if (digits.startsWith('0')) return refuse('A country code cannot start with 0. Check the digits after the +.');
  if (digits.startsWith('1')) {
    if (digits.length !== 11) return refuse('A number that starts with +1 is +1 and ten more digits.');
    return northAmerican(digits.slice(1));
  }
  if (digits.length < 8 || digits.length > 15) return refuse('A number with a country code has 8 to 15 digits in all.');
  return { ok: true, phone: `+${digits}` };
}

export function formatPhone(e164) {
  if (typeof e164 !== 'string') return '';
  const match = /^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

// A Set that cannot be changed after it is made: Object.freeze alone leaves add() working on a Set.
class FrozenSet extends Set {
  constructor(values) {
    super();
    for (const value of values) super.add(value);
    Object.freeze(this);
  }

  add() {
    throw new TypeError('This set cannot be changed.');
  }

  delete() {
    throw new TypeError('This set cannot be changed.');
  }

  clear() {
    throw new TypeError('This set cannot be changed.');
  }
}

export const CANADIAN_AREA_CODES = new FrozenSet([
  // Alberta
  '368', '403', '587', '780', '825',
  // British Columbia
  '236', '250', '257', '604', '672', '778',
  // Manitoba
  '204', '431', '584',
  // New Brunswick
  '428', '506',
  // Newfoundland and Labrador
  '709', '879',
  // Nova Scotia and Prince Edward Island
  '782', '902',
  // Ontario
  '226', '249', '289', '343', '365', '382', '416', '437', '519', '548', '613', '647', '683', '705', '742', '753', '807', '905', '942',
  // Quebec (273 starts on 2027-02-27)
  '263', '273', '354', '367', '418', '438', '450', '468', '514', '579', '581', '819', '873',
  // Saskatchewan
  '306', '474', '639',
  // Yukon, the Northwest Territories and Nunavut
  '867',
]);

export function canText(e164) {
  if (typeof e164 !== 'string') return false;
  const match = /^\+1([2-9]\d{2})[2-9]\d{2}\d{4}$/.exec(e164);
  return match !== null && CANADIAN_AREA_CODES.has(match[1]);
}
