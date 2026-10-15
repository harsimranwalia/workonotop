// @ts-check
// ENG-016: the clock rule of the job link's countdown timer, in plain Node. The thirteen vectors of the design's table
// (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md, "Cases and baseline") run against src/lib/job-clock.js, which is
// pure and has no import, so nothing in this file starts a browser, reaches the database or asks the running app. The server cases (the timer routes,
// the check-out and the reconcile, the events) and the screens are in the other ENG-016 files. Each title starts with the design's id for the row it
// settles, and the file's name, the describe and the title together are its baseline key:
//   AC3  V1, V2, V3, V7, V10 and V11: three cleaners on a six-hour quote read two hours each, and a fourth who arrives an hour in makes it 45 minutes;
//        nobody on the job reads null (not 0, and not the quote); seven cleaners on an hour read 515 seconds, rounded up; a quote that is NULL, 0 or
//        negative reads 60 minutes; a list or an end that is left out is read as none and as still open;
//   AC4  V3 and V4: a cleaner who arrives and one who leaves re-divide what is left on the spot, and the clock reads 0 at the second the labour is used;
//   AC5  V5, V6, V12 and V13: the pause is not counted; each cleaner is counted from the second they arrived; a cleaner taken off the crew keeps their
//        hour in used_seconds and per_member and is not counted as here; a stay ticked by mistake adds nothing; the per-cleaner seconds add up to the
//        total. Also a cleaner who left and came back, a stay or a stretch that begins after `now`, and overlapSeconds itself;
//   AC6  V8 and V9: past the quote the clock reads 0 and over_seconds says how far over each cleaner here is, and with nobody here it is the whole
//        overrun; a sweep of quotes, crews and times finds clock_seconds never below zero and over_seconds set exactly when left_seconds is below zero;
//   Pins  source checks: job-clock.js has no import statement or expression, and QUOTE_FALLBACK_MINUTES is exported at 60.
// V3 settles two rows (AC3 and AC4), so it has a case under each. The vectors count seconds from the start of the job and `now` is the second asked at,
// as the design's table does. A cleaner is a member id, and A to D below are the design's names for the first four. Every expected figure was worked out
// by hand from the table and never taken from a run of the library.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { QUOTE_FALLBACK_MINUTES, overlapSeconds, clockView } from '../src/lib/job-clock.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const HOUR = 3600;
const [A, B, C, D] = [1, 2, 3, 4];
const FIELDS = ['quote_seconds', 'used_seconds', 'left_seconds', 'crew_here', 'clock_seconds', 'over_seconds', 'per_member'];

/** Cleaner `member` on the job from `from` until `to` (null while they are here). */
const here = (member, from = 0, to = null) => ({ member, from, to });
/** A stretch the timer ran from `from` until `to` (null while it runs). */
const ran = (from = 0, to = null) => ({ from, to });
/** `count` cleaners (members 1, 2, ...) on the job from `from`, none of them gone. */
const crewOf = (count, from = 0) => Array.from({ length: count }, (_, index) => here(index + 1, from));
/** What a per_member map adds up to. */
const total = (perMember) => Object.values(perMember).reduce((sum, seconds) => sum + seconds, 0);

// =====================================================================================================================================
// The rule in plain Node
// =====================================================================================================================================
test.describe('ENG-016 clock: the rule in plain Node', () => {
    // Mutant that turns this case red: clockView leaves out a field, renames one or adds one, so the timer view and the pages built from it read a
    // key that is not there.
    test('AC3: V1: three cleaners on a six-hour quote, the clock just started, read two hours each, and the view has the seven fields of the design', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: crewOf(3), now: 0 });
        expect(Object.keys(view).sort(), 'exactly the fields of the design').toEqual([...FIELDS].sort());
        expect(view.quote_seconds, 'a quote of 360 minutes is 21600 seconds').toBe(21600);
        expect(view.used_seconds, 'at the second the clock starts nothing is used').toBe(0);
        expect(view.left_seconds, 'all of the labour is left').toBe(21600);
        expect(view.crew_here, 'three cleaners are here').toBe(3);
        expect(view.clock_seconds, "six labour-hours shared by three is two hours (7200 seconds) each, the contract's example").toBe(7200);
        expect(view.over_seconds, 'the job is not over the quote').toBeNull();
        expect(view.per_member, 'no cleaner has worked a second yet').toEqual({ [A]: 0, [B]: 0, [C]: 0 });
    });

    test('AC3: V2: an hour in, the same three cleaners have done three labour-hours and each reads one hour', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: crewOf(3), now: HOUR });
        expect(view.used_seconds, 'three cleaners for 3600 seconds is 10800 labour-seconds').toBe(10800);
        expect(view.left_seconds, 'half of the 21600 is left').toBe(10800);
        expect(view.crew_here, 'three are still here').toBe(3);
        expect(view.clock_seconds, '10800 shared by three is 3600 each').toBe(3600);
        expect(view.per_member, 'each of the three has worked the hour').toEqual({ [A]: HOUR, [B]: HOUR, [C]: HOUR });
    });

    // Mutant that turns this case red: a presence that begins at `now` is not counted as here (< where <= belongs), so the fourth cleaner is on the
    // job and the clock still divides by three.
    test('AC3: V3: a fourth cleaner who arrives an hour in is counted at once, so the 10800 left is shared by four and each reads 45 minutes', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: [...crewOf(3), here(D, HOUR)], now: HOUR });
        expect(view.used_seconds, 'the three have done 10800 and the fourth nothing yet').toBe(10800);
        expect(view.left_seconds, 'the other 10800 is left').toBe(10800);
        expect(view.crew_here, 'a cleaner whose stay begins at `now` is here').toBe(4);
        expect(view.clock_seconds, '10800 shared by four is 2700 each: 45 minutes, where the quote divided by four less the hour gone would say 30').toBe(2700);
        expect(view.per_member, 'the fourth is listed, at 0').toEqual({ [A]: HOUR, [B]: HOUR, [C]: HOUR, [D]: 0 });
    });

    test('AC3: V7: a stretch that runs while nobody is on the job counts for nothing, and the clock is null (not 0, and not the quote)', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(200)], presence: [here(A, 0, 100)], now: 300 });
        expect(view.used_seconds, 'A left at 100 and the stretch began at 200, so no second is both').toBe(0);
        expect(view.left_seconds, 'the whole quote is left').toBe(21600);
        expect(view.crew_here, 'A has gone: nobody is here').toBe(0);
        expect(view.clock_seconds, 'with nobody here there is nothing to count down for').toBeNull();
        expect(view.over_seconds, 'not over the quote').toBeNull();
        expect(view.per_member, 'A is listed, at 0').toEqual({ [A]: 0 });
    });

    // Mutant that turns this case red: the division rounds down (floor or round), so seven cleaners are told 514 seconds and the last second of the hour
    // is nobody's.
    test('AC3: V10: seven cleaners on a one-hour quote read 515 seconds each, because 3600 / 7 is rounded up', () => {
        const view = clockView({ quote_minutes: 60, sessions: [ran(0)], presence: crewOf(7), now: 0 });
        expect(view.crew_here, 'seven are here').toBe(7);
        expect(view.left_seconds, 'the whole hour is left').toBe(3600);
        expect(view.clock_seconds, 'ceil(3600 / 7) is ceil(514.28...), which is 515').toBe(515);
    });

    // Mutant that turns this case red: the fallback changes, or a quote of 0 or below is used as it stands, so a booking with no quote reads a different
    // time on the link than on the provider's own timer (whose `|| 60` the fallback is) or counts down from nothing.
    test('AC3: V11: a quote that is null, 0 or negative is the fallback of 60 minutes, and a quote above zero is used as it is', () => {
        expect(QUOTE_FALLBACK_MINUTES, "the fallback is the provider's timer route's `|| 60`").toBe(60);
        for (const quote_minutes of [null, 0, -5]) {
            const view = clockView({ quote_minutes, sessions: [ran(0)], presence: [here(A)], now: 0 });
            expect(view.quote_seconds, `a quote of ${quote_minutes} reads as 3600 seconds`).toBe(3600);
            expect(view.left_seconds, `a quote of ${quote_minutes}: the whole hour is left`).toBe(3600);
            expect(view.clock_seconds, `a quote of ${quote_minutes}: one cleaner reads an hour`).toBe(3600);
        }
        expect(clockView({ quote_minutes: 1, now: 0 }).quote_seconds, 'a quote of one minute is a quote: 60 seconds').toBe(60);
        expect(clockView({ quote_minutes: 90, now: 0 }).quote_seconds, 'a quote of 90 minutes is 5400 seconds').toBe(5400);
    });

    test('AC3: a list that is left out is empty, and a span with no `to` at all is still open, as one with a null is', () => {
        expect(clockView({ quote_minutes: 90, now: 100 }), 'no stretches and no presence: the whole quote is left and nobody is here').toEqual({
            quote_seconds: 5400, used_seconds: 0, left_seconds: 5400, crew_here: 0, clock_seconds: null, over_seconds: null, per_member: {},
        });
        const written = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: [here(A)], now: HOUR });
        const omitted = clockView({ quote_minutes: 360, sessions: [{ from: 0 }], presence: [{ member: A, from: 0 }], now: HOUR });
        expect(written.crew_here, 'a cleaner with a null `to` is here').toBe(1);
        expect(written.used_seconds, 'and has worked the hour of a stretch that is still running').toBe(HOUR);
        expect(omitted, 'a `to` that is left out reads the same as the null the design uses').toEqual(written);
    });

    // Mutant that turns this case red: the clock is the quote divided by the people less the time gone and not the labour left divided by the people
    // here, so a cleaner who arrives is told 30 minutes, or a clock that has run out keeps counting below zero.
    test('AC4: V3: a cleaner who arrives re-divides what is left on the spot, and when the four have used the last of it the clock reads 0', () => {
        const withFourth = [...crewOf(3), here(D, HOUR)];
        const before = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: crewOf(3), now: HOUR });
        const after = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: withFourth, now: HOUR });
        expect(before.clock_seconds, 'at 3600, before the fourth is counted, the three read 3600').toBe(3600);
        expect(after.clock_seconds, 'at 3600, with the fourth counted, the same labour is shared by four: 2700').toBe(2700);
        expect(after.left_seconds, 'arriving takes no labour from the job: the same 10800 is left').toBe(before.left_seconds);

        const done = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: withFourth, now: 6300 });
        expect(done.per_member, 'at 6300 the three have worked 6300 each and the fourth 2700').toEqual({ [A]: 6300, [B]: 6300, [C]: 6300, [D]: 2700 });
        expect(done.used_seconds, '3 x 6300 + 2700 is the whole quote').toBe(21600);
        expect(done.left_seconds, 'nothing is left').toBe(0);
        expect(done.crew_here, 'all four are still here').toBe(4);
        expect(done.clock_seconds, 'the clock reads 0').toBe(0);
        expect(done.over_seconds, 'with nothing left the job is not over: over_seconds needs left_seconds below zero').toBeNull();
    });

    // Mutant that turns this case red: crew_here counts a cleaner who has gone (the `to` is ignored), so the one who left is still handed a share of
    // the labour that is left and the two who stay are told too much time.
    test('AC4: V4: a cleaner who leaves re-divides what is left on the spot, and when the two who stay have used the last of it the clock reads 0', () => {
        const presence = [here(A), here(B), here(C, 0, HOUR)];
        const view = clockView({ quote_minutes: 360, sessions: [ran(0)], presence, now: HOUR });
        expect(view.used_seconds, 'C worked the hour before leaving: three cleaners for an hour is 10800').toBe(10800);
        expect(view.crew_here, 'C has gone: two are here').toBe(2);
        expect(view.clock_seconds, '10800 shared by the two who stay is 5400 each, not the 7200 of the quote divided by two less the hour gone').toBe(5400);
        expect(view.per_member, 'C keeps the hour').toEqual({ [A]: HOUR, [B]: HOUR, [C]: HOUR });

        const done = clockView({ quote_minutes: 360, sessions: [ran(0)], presence, now: 9000 });
        expect(done.used_seconds, 'at 9000 A and B have worked 9000 each and C 3600: the whole quote').toBe(21600);
        expect(done.left_seconds, 'nothing is left').toBe(0);
        expect(done.crew_here, 'the two are still here').toBe(2);
        expect(done.clock_seconds, 'the clock reads 0').toBe(0);
    });

    // Mutant that turns this case red: the stretches are read as one span from the first start to now, so the pause is counted as labour and the clock
    // runs out early.
    test('AC5: V5: a pause is not counted: stretches [0, 1800] and [3600, open] with three cleaners here throughout', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(0, 1800), ran(HOUR)], presence: crewOf(3), now: 5400 });
        expect(view.used_seconds, 'two stretches of 1800 seconds for three cleaners is 10800; the pause from 1800 to 3600 is not in it').toBe(10800);
        expect(view.per_member, 'each has worked 3600 of the 5400 since the start').toEqual({ [A]: HOUR, [B]: HOUR, [C]: HOUR });
        expect(view.left_seconds, 'the other 10800 is left').toBe(10800);
        expect(view.clock_seconds, '10800 shared by three is 3600 each').toBe(3600);
    });

    test('AC5: V6: each cleaner is counted from the second they arrived: A from 0 and B from 600 on a stretch that began at 0', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: [here(A), here(B, 600)], now: 1200 });
        expect(view.per_member, 'A has worked 1200 seconds and B 600').toEqual({ [A]: 1200, [B]: 600 });
        expect(view.used_seconds, 'the total is 1800').toBe(1800);
        expect(total(view.per_member), 'the per-cleaner seconds add up to used_seconds').toBe(view.used_seconds);
        expect(view.left_seconds, '21600 less 1800').toBe(19800);
        expect(view.crew_here, 'both are here').toBe(2);
        expect(view.clock_seconds, '19800 shared by two is 9900 each').toBe(9900);
    });

    // Mutant that turns this case red: a presence that has ended is left out of the sum (or only the cleaners here are listed), so the hour a cleaner
    // worked before they were taken off the crew is lost from the labour done and from their own record.
    test('AC5: V12: a cleaner taken off the crew keeps the hour they worked in used_seconds and per_member, and is not counted as here', () => {
        // B was on the job from 0 and was taken off at 3600; A is still here. The timer ran in three back-to-back stretches across B's hour and on past it.
        const sessions = [ran(0, 1200), ran(1200, 2400), ran(2400)];
        const view = clockView({ quote_minutes: 360, sessions, presence: [here(A), here(B, 0, HOUR)], now: 5400 });
        expect(view.per_member[B], "B's whole hour is in per_member").toBe(HOUR);
        expect(view.per_member[A], 'A has worked the 5400 since the start').toBe(5400);
        expect(view.used_seconds, "B's 3600 and A's 5400 are in the labour done").toBe(9000);
        expect(total(view.per_member), 'the per-cleaner seconds add up to used_seconds').toBe(view.used_seconds);
        expect(view.crew_here, 'B is not here: A is the only one').toBe(1);
        expect(view.clock_seconds, "21600 less 9000 is 12600 left, all of it A's").toBe(12600);
    });

    // Mutant that turns this case red: an overlap that is below zero is not clamped, so a stay that ended before the timer began takes labour off the
    // total instead of adding none.
    test('AC5: V13: a cleaner ticked in by mistake and checked out before the timer ran adds nothing', () => {
        const view = clockView({ quote_minutes: 60, sessions: [ran(200)], presence: [here(A, 0, 100), here(B)], now: 1200 });
        expect(view.per_member, 'A is listed at 0 and B has worked 1000').toEqual({ [A]: 0, [B]: 1000 });
        expect(view.used_seconds, "the labour done is B's 1000").toBe(1000);
        expect(total(view.per_member), 'the per-cleaner seconds add up to used_seconds').toBe(view.used_seconds);
        expect(view.crew_here, 'only B is here').toBe(1);
        expect(view.clock_seconds, "3600 less 1000 is 2600, all of it B's").toBe(2600);
    });

    // Mutant that turns this case red: a second stay of the same cleaner replaces the first in per_member instead of adding to it, so the hours of the
    // first stay vanish and the per-cleaner seconds no longer add up to the total.
    test('AC5: a cleaner who left and came back is one entry in per_member with both stays, and counts once as here', () => {
        const view = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: [here(A, 0, 1000), here(A, 2000)], now: 3000 });
        expect(view.per_member, 'A worked 1000 seconds, then another 1000').toEqual({ [A]: 2000 });
        expect(view.used_seconds, 'the labour done is both stays').toBe(2000);
        expect(view.crew_here, 'only the stay that has not ended is here').toBe(1);
        expect(view.clock_seconds, '19600 left, shared by the one who is here').toBe(19600);
    });

    // Mutant that turns this case red: a stay that begins after `now` counts as here (the `from <= now` test is dropped) or its negative overlap is
    // taken off the labour done.
    test('AC5: a stay or a stretch that begins after `now` is not here, has run for no time and adds no negative time', () => {
        const late = clockView({ quote_minutes: 360, sessions: [ran(0)], presence: [here(A), here(B, 900)], now: 600 });
        expect(late.per_member, 'B has worked nothing at 600, and not -300').toEqual({ [A]: 600, [B]: 0 });
        expect(late.used_seconds, "only A's 600 is used").toBe(600);
        expect(late.crew_here, 'B has not arrived: A is the only one here').toBe(1);
        expect(late.clock_seconds, "21600 less A's 600 is 21000, all of it A's").toBe(21000);

        const early = clockView({ quote_minutes: 360, sessions: [ran(900)], presence: [here(A)], now: 600 });
        expect(early.used_seconds, 'a stretch that begins at 900 has not run at 600: nothing is used, and not -300').toBe(0);
        expect(early.per_member, 'A has worked nothing').toEqual({ [A]: 0 });
        expect(early.clock_seconds, 'the whole quote is left for the one cleaner').toBe(21600);
    });

    // Mutant that turns this case red: the overlap is not clamped at 0 (spans that do not meet give a negative number), is rounded up, or counts spans
    // that only touch.
    test('AC5: overlapSeconds is the whole seconds both spans cover, 0 when they do not meet, whichever is named first', () => {
        const cases = [
            // aFrom, aTo, bFrom, bTo, seconds both cover, what the pair is
            [0, 100, 40, 70, 30, 'one span inside the other'],
            [0, 100, 60, 160, 40, 'a span that overlaps the end of the other'],
            [60, 160, 0, 100, 40, 'the same two the other way round'],
            [0, 100, 0, 100, 100, 'the same span twice'],
            [0, 100, 100, 200, 0, 'spans that only touch'],
            [0, 100, 150, 200, 0, 'spans with a gap between them'],
            [150, 200, 0, 100, 0, 'the same gap the other way round'],
            [50, 50, 0, 100, 0, 'a span of no length'],
            [100, 0, 0, 100, 0, 'a span that ends before it begins'],
        ];
        for (const [aFrom, aTo, bFrom, bTo, seconds, what] of cases) {
            expect(overlapSeconds(aFrom, aTo, bFrom, bTo), `${what}: [${aFrom}, ${aTo}] and [${bFrom}, ${bTo}]`).toBe(seconds);
        }
        expect(overlapSeconds(0, 100.5, 40, 200), 'half a second of overlap is not a second: 60.5 is 60').toBe(60);
        expect(overlapSeconds(0, 0.5, 0, 10), 'less than a second of overlap is none').toBe(0);
    });

    // Mutant that turns this case red: left_seconds is clamped at 0 or over_seconds is not shared among the cleaners here, so a job that has run over
    // shows no overrun, or one that is the whole of it to each of two.
    test('AC6: V8: two cleaners who have worked past a one-hour quote: left_seconds is negative, the clock reads 0 and over_seconds says how far over each is', () => {
        const view = clockView({ quote_minutes: 60, sessions: [ran(0)], presence: crewOf(2), now: 2000 });
        expect(view.used_seconds, 'two cleaners for 2000 seconds is 4000 labour-seconds, past the 3600 quoted').toBe(4000);
        expect(view.left_seconds, 'left_seconds goes below zero and is not clamped: 3600 less 4000').toBe(-400);
        expect(view.crew_here, 'both are still here').toBe(2);
        expect(view.clock_seconds, 'the clock stops at 0 and does not go negative').toBe(0);
        expect(view.over_seconds, '400 labour-seconds over, shared by two, is 200 each').toBe(200);
        expect(view.per_member, 'each has worked the 2000').toEqual({ [A]: 2000, [B]: 2000 });
    });

    // Mutant that turns this case red: over_seconds divides by crew_here as it stands (0 gives Infinity) or by the cleaners ever on the job, so a
    // stretch left running after everyone has gone reads an overrun that is not the whole of it.
    test('AC6: V9: with nobody here the clock is null, and over_seconds is null unless the labour was used up, and then the whole overrun', () => {
        const unattended = clockView({ quote_minutes: 60, sessions: [ran(0)], presence: [], now: 5000 });
        expect(unattended.used_seconds, 'a stretch with nobody on the job uses no labour').toBe(0);
        expect(unattended.left_seconds, 'the whole quote is left').toBe(3600);
        expect(unattended.crew_here, 'nobody is here').toBe(0);
        expect(unattended.clock_seconds, 'with nobody here the clock is null').toBeNull();
        expect(unattended.over_seconds, 'the job is not over the quote').toBeNull();

        // Two cleaners worked 2400 seconds each (4800 against 3600 quoted) and both went at 2400; the stretch is still running at 3000.
        const gone = clockView({ quote_minutes: 60, sessions: [ran(0)], presence: [here(A, 0, 2400), here(B, 0, 2400)], now: 3000 });
        expect(gone.used_seconds, 'the two worked 2400 each').toBe(4800);
        expect(gone.left_seconds, '3600 less 4800').toBe(-1200);
        expect(gone.crew_here, 'both have gone').toBe(0);
        expect(gone.clock_seconds, 'with nobody here the clock is null even when the job is over').toBeNull();
        expect(gone.over_seconds, 'the overrun is shared among one when nobody is here: 1200, and not 600 (the two who left) or infinity').toBe(1200);
    });

    // Mutant that turns this case red: clock_seconds is not held at 0 once the labour is used (it goes negative), is rounded down, or over_seconds is set
    // when left_seconds is not below zero.
    test('AC6: clock_seconds is never below zero and over_seconds is set exactly when left_seconds is, over a sweep of quotes, crews and times', () => {
        const broken = [];
        for (const quote_minutes of [null, 30, 60, 360]) {
            for (const crew of [0, 1, 2, 3, 7]) {
                // The timer runs for 900 seconds, pauses until 1800 and runs on; the sweep goes four hours in, past the quotes that seven cleaners use up.
                for (let now = 0; now <= 4 * HOUR; now += 150) {
                    const view = clockView({ quote_minutes, sessions: [ran(0, 900), ran(1800)], presence: crewOf(crew), now });
                    const { clock_seconds: clock, over_seconds: over } = view;
                    const left = Math.max(view.left_seconds, 0);
                    const overrun = Math.max(-view.left_seconds, 0);
                    const sharers = Math.max(crew, 1);
                    // The rounding is judged without Math.ceil: the share times the people covers what is shared, and one second less does not.
                    const rules = [
                        [view.crew_here === crew, 'crew_here is the cleaners given'],
                        [(clock === null) === (crew === 0), 'clock_seconds is null exactly when nobody is here'],
                        [clock === null || (Number.isInteger(clock) && clock >= 0 && !Object.is(clock, -0)), 'clock_seconds is a whole number, 0 or more'],
                        [clock === null || (clock * crew >= left && (clock - 1) * crew < left), 'clock_seconds is the labour left shared by those here, rounded up'],
                        [(over === null) === (view.left_seconds >= 0), 'over_seconds is set exactly when left_seconds is below zero'],
                        [over === null || (Number.isInteger(over) && over * sharers >= overrun && (over - 1) * sharers < overrun), 'over_seconds is the overrun shared by those here, rounded up'],
                        [view.left_seconds === view.quote_seconds - view.used_seconds, 'left_seconds is the quote less the labour done'],
                        [total(view.per_member) === view.used_seconds, 'the per-cleaner seconds add up to used_seconds'],
                    ];
                    for (const [holds, rule] of rules) if (!holds) broken.push(`${rule} (quote ${quote_minutes}, crew ${crew}, now ${now})`);
                }
            }
        }
        expect(broken.slice(0, 5), 'the first points of the sweep that break a rule of the clock').toEqual([]);
    });
});

// =====================================================================================================================================
// Pins: source checks, no database and no app
// =====================================================================================================================================

// A source file's text with its comments taken out (block comments, whole-line comments, and a // comment that follows whitespace), so that a word a
// comment mentions is not read as a use of it (as e2e/provider-crew.spec.js does).
function withoutComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/.*$/gm, '$1');
}

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test.describe('ENG-016 clock: pins', () => {
    // Mutant that turns this case red: job-clock.js imports something, so a spec and the timer can no longer load the rule in plain Node, and the
    // database or a date library gets between the rows and the number a cleaner reads.
    test('Pins: src/lib/job-clock.js has no import statement or expression', () => {
        const code = withoutComments(textOf('src/lib/job-clock.js'));
        expect(code.includes('export function clockView'), 'the file is the clock rule').toBe(true);
        expect(/(?:^|[^\w$.])import\s*(?:\(|[\w$*{'"])/.test(code), 'an import statement or a dynamic import').toBe(false);
        expect(/\bexport\s+(?:\*|\{[^}]*\})\s*from\b/.test(code), 'a re-export from another file').toBe(false);
        expect(/\brequire\s*\(/.test(code), 'a require call').toBe(false);
    });

    // Mutant that turns this case red: the fallback quote is changed, or is no longer exported at its value, so a booking with no quote reads a
    // different time on the link than on the provider's own timer, and nothing says so.
    test('Pins: QUOTE_FALLBACK_MINUTES is exported at 60, with overlapSeconds and clockView', () => {
        const code = withoutComments(textOf('src/lib/job-clock.js'));
        expect(/\bexport\s+const\s+QUOTE_FALLBACK_MINUTES\s*=\s*60\s*;/.test(code), 'the source declares and exports it at 60').toBe(true);
        expect(QUOTE_FALLBACK_MINUTES, 'the value the library exports is 60').toBe(60);
        const exported = [...code.matchAll(/\bexport\s+(?:const|function)\s+(\w+)/g)].map((match) => match[1]);
        for (const name of ['QUOTE_FALLBACK_MINUTES', 'overlapSeconds', 'clockView']) {
            expect(exported.includes(name), `${name} is exported`).toBe(true);
        }
    });
});
