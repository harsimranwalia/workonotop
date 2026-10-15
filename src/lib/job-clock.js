// src/lib/job-clock.js
//
// How much of a job's quoted labour is left, and what that is for each cleaner on the job (ENG-016 design, Interfaces 1; ADR-014). The quote is the
// whole job's labour (bookings.standard_duration_minutes), so six quoted hours are six labour-hours whether one cleaner works them or three share
// them. Labour done is the sum, over every stretch the job's timer ran and every cleaner, of the seconds the stretch and that cleaner's stay on the
// job overlap: a pause counts for nothing, a stretch with nobody ticked in counts for nothing, and a cleaner who left, or was taken off the crew,
// keeps the hours they worked. What a cleaner reads is the labour left shared among the cleaners who are here now, so it re-divides on the spot when
// the crew changes: three cleaners on six quoted hours read two hours each, and a fourth who arrives an hour in finds three labour-hours done and
// three left for four people, 45 minutes each, where "the quote divided by the people, less the time gone" would say 30. Nothing here ticks:
// job_sessions (when the clock ran) and job_checkins (who was there) are the record, and the same rows give the same answer whenever they are read.
// Going over the quote is a flag, and nothing is billed for it.
//
// Everything here is pure: no database, no clock, no network, and no import at all, so a spec loads this file in plain Node (a case pins that).
// Times are epoch seconds, whole numbers, taken from the database's clock as src/lib/job-window.js takes its own, and `now` is the instant asked at.
// A span that has not ended has `to` null and is read as ending at `now`.
//
// Constants (one-line changes, no migration):
//   QUOTE_FALLBACK_MINUTES  60   the quote when bookings.standard_duration_minutes is NULL, 0 or below. It is the `|| 60` of the provider's own
//                                timer route (src/app/api/provider/jobs/time-tracking/route.js), so the two agree on a booking with no quote.
//
// overlapSeconds(aFrom, aTo, bFrom, bTo) -> whole seconds that both spans cover, 0 when they do not meet (spans that only touch do not meet).
// clockView({ quote_minutes, sessions, presence, now }) ->
//   { quote_seconds, used_seconds, left_seconds, crew_here, clock_seconds, over_seconds, per_member }
//   sessions is [{ from, to }], the stretches the timer ran. presence is [{ member, from, to }], when each cleaner was on the job; the ones who have
//   left or were taken off the crew stay in it, because their hours were worked, and a cleaner who came back is a second entry with the same
//   member. A list that is left out is empty.
//   quote_seconds  the quote in seconds: quote_minutes, or QUOTE_FALLBACK_MINUTES when that is not above zero, times 60.
//   used_seconds   the labour done: the sum, over sessions and presences, of the seconds they overlap.
//   left_seconds   quote_seconds less used_seconds. It is below zero once the job runs over.
//   crew_here      the presences that have not ended and began at or before `now`: the cleaners who share what is left.
//   clock_seconds  what each cleaner here has left: left_seconds shared among crew_here, rounded up, and 0 once the labour is used. null when
//                  nobody is here, because there is no one to share it among.
//   over_seconds   when left_seconds is below zero, how far over the quote each cleaner here is: the overrun shared the same way (by one when
//                  nobody is here); else null.
//   per_member     { [member]: seconds }, each cleaner's share of used_seconds. Every member given is listed, at 0 when the clock never ran while
//                  they were there, and a cleaner with two stays has the sum of both. The values add up to used_seconds.
export const QUOTE_FALLBACK_MINUTES = 60;

const hasEnded = (to) => to !== null && to !== undefined;

export function overlapSeconds(aFrom, aTo, bFrom, bTo) {
  const seconds = Math.min(aTo, bTo) - Math.max(aFrom, bFrom);
  return seconds > 0 ? Math.floor(seconds) : 0;
}

export function clockView({ quote_minutes, sessions = [], presence = [], now } = {}) {
  const quote_seconds = (quote_minutes > 0 ? quote_minutes : QUOTE_FALLBACK_MINUTES) * 60;
  const per_member = {};
  for (const stay of presence) {
    let seconds = per_member[stay.member] ?? 0;
    for (const stretch of sessions) seconds += overlapSeconds(stretch.from, stretch.to ?? now, stay.from, stay.to ?? now);
    per_member[stay.member] = seconds;
  }
  const used_seconds = Object.values(per_member).reduce((sum, seconds) => sum + seconds, 0);
  const left_seconds = quote_seconds - used_seconds;
  const crew_here = presence.filter((stay) => !hasEnded(stay.to) && stay.from <= now).length;
  return {
    quote_seconds,
    used_seconds,
    left_seconds,
    crew_here,
    clock_seconds: crew_here > 0 ? Math.ceil(Math.max(left_seconds, 0) / crew_here) : null,
    over_seconds: left_seconds < 0 ? Math.ceil(-left_seconds / Math.max(crew_here, 1)) : null,
    per_member,
  };
}
