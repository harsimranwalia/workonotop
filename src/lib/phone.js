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
