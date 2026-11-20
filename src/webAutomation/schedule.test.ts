import { describe, expect, it } from 'vitest';
import { readScheduleBlockConfig, type ScheduleBlockConfig } from './configs';
import type { ScheduledDocuments } from './scheduleSettings';

// Scheduled documents by path, as these tests key them (Galaxy keys them by file reference).
const none: ScheduledDocuments<string> = {};
import { clockText, dueJobs, jobTurnText, withoutScheduledDocumentsIn, scheduleStatusText, withChangesApplied, jobTiming, nextTimeOfDay, normalizeScheduledDocuments, scheduledFor, timingText, withJobTiming, withJobOn, withJobResult, withoutUnused, withScheduleBlock, withScheduleChange } from './scheduleSettings';

const block = (overrides: Record<string, unknown> = {}) => readScheduleBlockConfig({
  schemaVersion: 1,
  jobs: [{ id: 'fetch-due', name: 'Fetch due pages', script: 'fetch_due', everyMinutes: 360 }],
  scripts: { fetch_due: 'print("fetching")' },
  ...overrides,
});
const config = (overrides: Record<string, unknown> = {}): ScheduleBlockConfig => {
  const read = block(overrides);
  if (!read.ok) throw new Error(read.errors.join(' '));
  return read.value;
};

describe('a schedule block', () => {
  it('reads its jobs, its own scripts, and the pauses its scripts made, keeping only pauses of its jobs', () => {
    expect(config({ heavy: true, scriptLibraries: ['re'], state: { paused: { 'fetch-due': 'Out of credits', gone: 'old' } } })).toEqual({
      jobs: [{ id: 'fetch-due', name: 'Fetch due pages', script: 'fetch_due', timing: { every: 360 } }],
      scripts: { fetch_due: 'print("fetching")' },
      scriptLibraries: ['re'],
      heavy: true,
      paused: { 'fetch-due': 'Out of credits' },
    });
  });

  it('refuses a job that runs more often than every 5 minutes, a script it doesn\'t have, and an id used twice', () => {
    const read = block({ jobs: [
      { id: 'often', script: 'fetch_due', everyMinutes: 2 },
      { id: 'missing', script: 'nowhere', everyMinutes: 60 },
      { id: 'often', script: 'fetch_due', everyMinutes: 60 },
    ] });
    expect(read.ok ? [] : read.errors).toEqual([
      'Job "often" must run every 5 minutes or more (a whole number of minutes), or at a time of day ("at": "HH:MM").',
      'Job "missing" runs "nowhere", which is not one of the block\'s scripts.',
      'Job id "often" is used twice.',
    ]);
  });
});

describe('what the user chose for scheduled documents', () => {
  it('keeps a document only once its jobs are set up, follows its block from then, and drops it once nothing is the user\'s', () => {
    // Opened with a schedule block, never set up: not listed.
    expect(withScheduleBlock(none, '/work/jobs.hvy', 'jobs.hvy', config())).toEqual({});
    expect(scheduledFor(none, '/work/jobs.hvy', 'jobs.hvy', config())).toEqual({
      name: 'jobs.hvy', idleMinutes: 5,
      jobs: [{ id: 'fetch-due', name: 'Fetch due pages', timing: { every: 360 } }],
      choices: {}, scheduledFrom: {}, lastResults: {},
    });
    // Turned on in its block: kept.
    const on = withScheduleChange(none, '/work/jobs.hvy', 'jobs.hvy', config(), (document) => withJobOn(document, 'fetch-due', true));
    expect(on['/work/jobs.hvy'].choices).toEqual({ 'fetch-due': { on: true } });
    // Opened again unchanged: the same settings, so nothing is saved.
    expect(withScheduleBlock(on, '/work/jobs.hvy', 'jobs.hvy', config())).toBe(on);
    // A frequency of their own, set before turning it on, is kept too.
    const every = withScheduleChange(none, '/work/jobs.hvy', 'jobs.hvy', config(), (document) => withJobTiming(document, 'fetch-due', { every: 60 }));
    expect(every['/work/jobs.hvy'].choices).toEqual({ 'fetch-due': { on: false, timing: { every: 60 } } });
    // The job removed from the block: nothing of it is the user's any more, so the document drops out.
    expect(withScheduleBlock(on, '/work/jobs.hvy', 'jobs.hvy', config({ jobs: [{ id: 'other', script: 'fetch_due', everyMinutes: 60 }] }))).toEqual({});
    // Turned off (in its block, or in Scheduled jobs): dropped.
    expect(withScheduleChange(on, '/work/jobs.hvy', 'jobs.hvy', config(), (document) => withJobOn(document, 'fetch-due', false))).toEqual({});
    expect(withoutUnused({ '/work/jobs.hvy': withJobOn(on['/work/jobs.hvy'], 'fetch-due', false) })).toEqual({});
  });

  it('runs a job as often as the user set, never under 5 minutes, and its default again when set back to it', () => {
    const scheduled = scheduledFor(none, '/work/jobs.hvy', 'jobs.hvy', config());
    expect(jobTiming(scheduled, 'fetch-due')).toEqual({ every: 360 });
    expect(jobTiming(withJobTiming(scheduled, 'fetch-due', { every: 1 }), 'fetch-due')).toEqual({ every: 5 });
    expect(withJobTiming(withJobTiming(scheduled, 'fetch-due', { every: 60 }), 'fetch-due', { every: 360 }).choices['fetch-due']).toEqual({ on: false });
  });

  it('drops what is malformed in saved settings', () => {
    expect(normalizeScheduledDocuments({
      '/work/jobs.hvy': { name: 'jobs.hvy', jobs: [{ id: 'a', timing: { every: 1 } }, { id: 'b', timing: { at: '2:00', days: [1, 9] } }, { name: 'no id' }], choices: { a: { on: true, timing: { every: 2 } }, gone: { on: true } }, scheduledFrom: { a: 5, b: 'x' }, idleMinutes: 0 },
      '': { name: 'nameless' },
      '/never-set-up.hvy': { name: 'never-set-up.hvy', jobs: [{ id: 'a', timing: { every: 60 } }], choices: {} },
    })).toEqual({
      '/work/jobs.hvy': { name: 'jobs.hvy', idleMinutes: 5, jobs: [{ id: 'a', name: 'a', timing: { every: 5 } }, { id: 'b', name: 'b', timing: { at: '02:00', days: [1] } }], choices: { a: { on: true, timing: { every: 5 } } }, scheduledFrom: { a: 5 }, lastResults: {} },
    });
  });

  it('runs the jobs due, those never run first and then the most overdue, each only when on', () => {
    const MINUTE = 60_000;
    const scheduled = (path: string, everyMinutes: number) => scheduledFor(none, path, path, config({ jobs: [{ id: 'job', script: 'fetch_due', everyMinutes }] }));
    const on = (document: ReturnType<typeof scheduled>) => withJobOn(document, 'job', true);
    const now = 1_000 * MINUTE;
    const documents = {
      '/never.hvy': on(scheduled('/never.hvy', 60)),
      '/late.hvy': { ...on(scheduled('/late.hvy', 60)), scheduledFrom: { job: now - 120 * MINUTE } },
      '/later.hvy': { ...on(scheduled('/later.hvy', 60)), scheduledFrom: { job: now - 300 * MINUTE } },
      '/recent.hvy': { ...on(scheduled('/recent.hvy', 60)), scheduledFrom: { job: now - 10 * MINUTE } },
      '/off.hvy': scheduled('/off.hvy', 60),
    };
    expect(dueJobs(documents, now).map((job) => job.file)).toEqual(['/never.hvy', '/later.hvy', '/late.hvy']);
    // A skipped turn counts as its turn: the next is a whole frequency later.
    const skipped = withJobResult(documents['/never.hvy'], 'job', { at: now, outcome: 'skipped', message: 'You were using Galaxy.' });
    expect(dueJobs({ '/never.hvy': skipped }, now + 30 * MINUTE)).toEqual([]);
  });

  it('says a job\'s last turn and, while it is on, its next', () => {
    const MINUTE = 60_000;
    const now = 10_000 * MINUTE;
    const scheduled = scheduledFor(none, '/jobs.hvy', 'jobs.hvy', config());
    // Off: its checkbox says so; with no turn yet, nothing else to say.
    expect(jobTurnText(scheduled, 'fetch-due', now)).toBe('');
    const on = withJobOn(scheduled, 'fetch-due', true);
    expect(jobTurnText(on, 'fetch-due', now)).toBe('Not triggered yet · next once you’re idle');
    const triggered = withJobResult(on, 'fetch-due', { at: now - 120 * MINUTE, outcome: 'triggered' });
    expect(jobTurnText(triggered, 'fetch-due', now)).toBe(`Triggered at ${clockText(now - 120 * MINUTE, now)} · next at ${clockText(now + 240 * MINUTE, now)}`);
    const failed = withJobResult(on, 'fetch-due', { at: now - 3 * MINUTE, outcome: 'failed', message: 'Its script failed.' });
    expect(jobTurnText(failed, 'fetch-due', now)).toBe(`Failed at ${clockText(now - 3 * MINUTE, now)}: Its script failed. · next at ${clockText(now + 357 * MINUTE, now)}`);
  });

  it('applies a job turned on, or its frequency changed, from now: its next turn a frequency later, not at once', () => {
    const MINUTE = 60_000;
    const now = 10_000 * MINUTE;
    const off = scheduledFor(none, '/jobs.hvy', 'jobs.hvy', config());
    const on = withChangesApplied(off, { choices: { 'fetch-due': { on: true } }, idleMinutes: 5 }, now);
    expect(dueJobs({ '/jobs.hvy': on }, now)).toEqual([]);
    expect(jobTurnText(on, 'fetch-due', now)).toBe(`Not triggered yet · next at ${clockText(now + 360 * MINUTE, now)}`);
    expect(dueJobs({ '/jobs.hvy': on }, now + 360 * MINUTE).map((job) => job.jobId)).toEqual(['fetch-due']);
    // Changed to every hour two hours into its turn: its next is an hour from the change.
    const faster = withChangesApplied(on, { choices: { 'fetch-due': { on: true, timing: { every: 60 } } }, idleMinutes: 5 }, now + 120 * MINUTE);
    expect(jobTurnText(faster, 'fetch-due', now + 120 * MINUTE)).toBe(`Not triggered yet · next at ${clockText(now + 180 * MINUTE, now + 120 * MINUTE)}`);
    // Only the wait changed: its schedule is left as it is.
    expect(withChangesApplied(on, { choices: on.choices, idleMinutes: 10 }, now + 5 * MINUTE).scheduledFrom).toEqual(on.scheduledFrom);
  });

  it('says in the header the job that runs next, by name when several are on', () => {
    const MINUTE = 60_000;
    const now = 10_000 * MINUTE;
    const two = config({ jobs: [{ id: 'fetch-due', name: 'Fetch due pages', script: 'fetch_due', everyMinutes: 360 }, { id: 'tidy', name: 'Tidy', script: 'fetch_due', everyMinutes: 60 }] });
    const document = scheduledFor(none, '/jobs.hvy', 'jobs.hvy', two);
    expect(scheduleStatusText(document, now)).toBe('');
    const one = withChangesApplied(document, { choices: { 'fetch-due': { on: true } }, idleMinutes: 5 }, now);
    expect(scheduleStatusText(one, now)).toBe(`Not triggered yet · next at ${clockText(now + 360 * MINUTE, now)}`);
    const both = withChangesApplied(one, { choices: { 'fetch-due': { on: true }, tidy: { on: true } }, idleMinutes: 5 }, now);
    expect(scheduleStatusText(both, now)).toBe(`Tidy: Not triggered yet · next at ${clockText(now + 60 * MINUTE, now)}`);
  });

  it('says times as a clock reads them, which stay right however long they are shown: the time today, the day within a week, the date further off', () => {
    const now = new Date(2026, 10, 18, 15, 37).getTime();
    const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    expect(clockText(now + 60 * 60_000, now)).toBe(new Date(now + 60 * 60_000).toLocaleTimeString([], time));
    const tomorrow = new Date(2026, 10, 19, 9, 0).getTime();
    expect(clockText(tomorrow, now)).toBe(new Date(tomorrow).toLocaleString([], { weekday: 'short', ...time }));
    const later = new Date(2026, 11, 3, 9, 0).getTime();
    expect(clockText(later, now)).toBe(new Date(later).toLocaleString([], { month: 'short', day: 'numeric', ...time }));
  });

  it('drops the documents a workspace archived or a folder deleted held, and keeps the rest as they are', () => {
    const on = (path: string) => withScheduleChange(none, path, path, config(), (document) => withJobOn(document, 'fetch-due', true))[path];
    const documents = { '/work/a.hvy': on('/work/a.hvy'), '/work/old/b.hvy': on('/work/old/b.hvy'), '/other/c.hvy': on('/other/c.hvy') };
    expect(Object.keys(withoutScheduledDocumentsIn(documents, (path) => path.startsWith('/work/old/')))).toEqual(['/work/a.hvy', '/other/c.hvy']);
    expect(withoutScheduledDocumentsIn(documents, () => false)).toBe(documents);
  });

  it('runs a job at a time of day on the days chosen, its next after its last turn; a time missed runs once when it can', () => {
    const at = (day: number, hours: number, minutesPart = 0) => new Date(2026, 10, day, hours, minutesPart).getTime();
    // Wed 18 Nov 2026, 3:37 PM: daily at 2:00 AM is tomorrow; Mon/Fri at 2:00 AM is Friday.
    expect(nextTimeOfDay(at(18, 15, 37), '02:00', [])).toBe(at(19, 2));
    expect(nextTimeOfDay(at(18, 15, 37), '02:00', [1, 5])).toBe(at(20, 2));
    expect(nextTimeOfDay(at(19, 2), '02:00', [])).toBe(at(20, 2));
    const nightly = withChangesApplied(scheduledFor(none, '/jobs.hvy', 'jobs.hvy', config()), { choices: { 'fetch-due': { on: true, timing: { at: '02:00', days: [] } } }, idleMinutes: 5 }, at(18, 15, 37));
    expect(dueJobs({ '/jobs.hvy': nightly }, at(19, 1, 59))).toEqual([]);
    expect(dueJobs({ '/jobs.hvy': nightly }, at(19, 2)).map((job) => job.jobId)).toEqual(['fetch-due']);
    // Galaxy closed at 2:00 AM: due once, when it can (9:00 AM); then tomorrow at 2:00 AM, not again today.
    expect(dueJobs({ '/jobs.hvy': nightly }, at(19, 9)).map((job) => job.jobId)).toEqual(['fetch-due']);
    const ran = withJobResult(nightly, 'fetch-due', { at: at(19, 9), outcome: 'triggered' });
    expect(dueJobs({ '/jobs.hvy': ran }, at(19, 23))).toEqual([]);
    expect(jobTurnText(ran, 'fetch-due', at(19, 9))).toBe(`Triggered at ${clockText(at(19, 9), at(19, 9))} · next at ${clockText(at(20, 2), at(19, 9))}`);
  });

  it('reads a block\'s time of day and days, and says a timing in words', () => {
    expect(config({ jobs: [{ id: 'nightly', script: 'fetch_due', at: '2:00', days: ['mon', 'fri', 'mon'] }] }).jobs[0].timing).toEqual({ at: '02:00', days: [1, 5] });
    const read = block({ jobs: [{ id: 'nightly', script: 'fetch_due', at: '25:00', days: ['funday'] }] });
    expect(read.ok ? [] : read.errors).toEqual([
      'Job "nightly" runs at "25:00", which is not a time of day ("HH:MM").',
      'Job "nightly" runs on "funday", which is not a day ("mon" to "sun").',
    ]);
    const time = new Date(2000, 0, 1, 2, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(timingText({ every: 360 })).toBe('every 6 hours');
    expect(timingText({ at: '02:00', days: [] })).toBe(`daily at ${time}`);
    expect(timingText({ at: '02:00', days: [1, 2, 3, 4, 5] })).toBe(`weekdays at ${time}`);
    expect(timingText({ at: '02:00', days: [1, 3] })).toBe(`Mon, Wed at ${time}`);
  });
});
