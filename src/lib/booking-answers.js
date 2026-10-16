// The answers a booking is priced by, built in one place from the customer's choices: only the keys the pricing rule reads, each
// present only when answered. The job's first date is the date that prices it. A booking that repeats also carries its frequency
// ('weekly', 'every_2_weeks' or 'monthly'); a booking that happens once has no frequency key.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isCount = (value) => Number.isSafeInteger(value) && value > 0;

// Hours as this page takes them: a number from 1 to 24 with at most two decimals (the pricing rule takes any number above 0 with at most two decimals), else null.
export function hoursAnswer(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const hours = Number(text);
  return Number.isFinite(hours) && hours >= 1 && hours <= 24 ? hours : null;
}

export function bookingAnswers(selections, jobDates, choices, frequency) {
  const picked = selections || {};
  const items = Array.isArray(choices) ? choices : [];
  const ofKind = (kind) => items.filter((item) => item && item.kind === kind);
  const answers = {};

  const units = {};
  for (const item of ofKind('unit')) {
    const quantity = Number(picked.units?.[item.code]);
    if (isCount(quantity)) units[item.code] = quantity;
  }
  if (Object.keys(units).length > 0) answers.units = units;

  const option = ofKind('option').find((item) => item.code === picked.option);
  if (option) {
    answers.option = option.code;
    if (Number(option.is_hourly) === 1) {
      const hours = hoursAnswer(picked.hours);
      if (hours !== null) answers.hours = hours;
    }
  }

  const propertyType = ofKind('property_type').find((item) => item.code === picked.propertyType);
  if (propertyType) answers.property_type = propertyType.code;

  const first = Array.isArray(jobDates) ? jobDates[0] : undefined;
  if (typeof first === 'string' && first) answers.date = first;

  if (typeof frequency === 'string' && frequency !== '' && frequency !== 'once') answers.frequency = frequency;

  const extras = [];
  for (const item of ofKind('extra')) {
    const quantity = Number(picked.extras?.[item.code]);
    if (isCount(quantity)) extras.push({ code: item.code, quantity });
  }
  if (extras.length > 0) answers.extras = extras;

  return answers;
}

// The same answers without the date and the frequency, as steps before the date is chosen send them.
export function answersWithoutWhen(answers) {
  const rest = { ...(answers || {}) };
  delete rest.date;
  delete rest.frequency;
  return rest;
}

// 'Oct 17', 'Sat, Oct 17' or 'October 17, 2026' for '2026-10-17', read from the date's own numbers so no time zone moves the day.
export function dayLabel(yyyyMmDd, style = 'short') {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof yyyyMmDd === 'string' ? yyyyMmDd : '');
  if (!parts) return typeof yyyyMmDd === 'string' ? yyyyMmDd : '';
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const monthName = MONTHS[month - 1];
  if (!monthName) return yyyyMmDd;
  if (style === 'long') return `${monthName} ${day}, ${year}`;
  const short = `${monthName.slice(0, 3)} ${day}`;
  if (style !== 'weekday') return short;
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${short}`;
}
