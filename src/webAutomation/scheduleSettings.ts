import { readTiming, SCHEDULE_MAX_MINUTES, SCHEDULE_MIN_MINUTES, type ScheduleBlockConfig, type ScheduleTiming } from './configs';

/**
 * What the user chose for a document's scheduled jobs (docs/job-search/12-scheduled-jobs.md), kept in Galaxy's app
 * settings by file path, not in the document: a distributed document is turned on or off without editing it, and a
 * closed document's jobs are known without opening it. Kept only while in use (`inUse`): a document with a schedule
 * block that the user never set up is not kept at all, so documents opened and left don't pile up.
 */
export interface ScheduledDocument {
  /** The file's name, for listing it. */
  name: string;
  /** How long the user must have been idle in Galaxy, in minutes, before one of its jobs starts. */
  idleMinutes: number;
  /** Its jobs as its schedule block last declared them, with when each runs by default. */
  jobs: Array<{ id: string; name: string; timing: ScheduleTiming }>;
  /** The user's choice for each job: off until turned on, and when it runs if changed from its default. */
  choices: Record<string, { on: boolean; timing?: ScheduleTiming }>;
  /**
   * When each job's schedule last started counting (ms): its last turn (triggered, failed, or skipped), or when the user
   * turned it on or changed when it runs. Its next turn is the next after this (a frequency later, or its next time of
   * day), so what is due holds across restarts, and a job turned on runs then, not at once.
   */
  scheduledFrom: Record<string, number>;
  /** What each job's last turn did: its script was triggered, failed to be, or the turn was skipped (and why). */
  lastResults: Record<string, ScheduledJobResult>;
}

/**
 * A job's turn. A job is a one-shot trigger, as pressing a button is: its script runs once, and what the script starts
 * (a fetch, its callbacks) is the document's, not the job's. So a turn is over once it triggered, and nothing of it
 * is left running to report on, or to be cut short by Galaxy closing.
 */
export interface ScheduledJobResult {
  at: number;
  outcome: 'triggered' | 'failed' | 'skipped';
  message?: string;
}

/** Scheduled documents by file path. */
export type ScheduledDocuments = Record<string, ScheduledDocument>;

/** How many scheduled jobs' work may go on at once (Settings, "Jobs at once"): by default one after another. */
export const DEFAULT_SCHEDULED_JOBS_AT_ONCE = 1;
export const MAX_SCHEDULED_JOBS_AT_ONCE = 4;

/** The stored "Jobs at once", a whole number within its bounds, or its default. */
export function normalizeScheduledJobsAtOnce(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(MAX_SCHEDULED_JOBS_AT_ONCE, Math.max(1, value)) : DEFAULT_SCHEDULED_JOBS_AT_ONCE;
}

/** The wait after the user's last input in Galaxy, unless a document sets its own. */
export const DEFAULT_IDLE_MINUTES = 5;

const minutes = (value: unknown, fallback: number, min: number): number => (
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= SCHEDULE_MAX_MINUTES ? value : fallback
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Scheduled documents as saved, dropping what is malformed, and documents no longer in use, rather than failing. */
export function normalizeScheduledDocuments(value: unknown): ScheduledDocuments {
  if (!isRecord(value)) return {};
  return withoutUnused(Object.fromEntries(Object.entries(value).flatMap(([path, raw]): Array<[string, ScheduledDocument]> => {
    if (!path.trim() || !isRecord(raw)) return [];
    const jobs = (Array.isArray(raw.jobs) ? raw.jobs : []).flatMap((job) => {
      const timing = isRecord(job) ? readTiming(job.timing) : null;
      return isRecord(job) && typeof job.id === 'string' && job.id && timing
        ? [{ id: job.id, name: typeof job.name === 'string' && job.name ? job.name : job.id, timing }]
        : [];
    });
    const ids = new Set(jobs.map((job) => job.id));
    const choices = Object.fromEntries(Object.entries(isRecord(raw.choices) ? raw.choices : {}).flatMap(([id, choice]) => {
      const timing = isRecord(choice) ? readTiming(choice.timing) : null;
      return ids.has(id) && isRecord(choice) ? [[id, { on: choice.on === true, ...(timing ? { timing } : {}) }]] : [];
    }));
    const scheduledFrom = Object.fromEntries(Object.entries(isRecord(raw.scheduledFrom) ? raw.scheduledFrom : {})
      .filter((entry): entry is [string, number] => ids.has(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1])));
    const lastResults = Object.fromEntries(Object.entries(isRecord(raw.lastResults) ? raw.lastResults : {}).flatMap(([id, result]): Array<[string, ScheduledJobResult]> => (
      ids.has(id) && isRecord(result) && typeof result.at === 'number' && (result.outcome === 'triggered' || result.outcome === 'failed' || result.outcome === 'skipped')
        ? [[id, { at: result.at, outcome: result.outcome, ...(typeof result.message === 'string' && result.message ? { message: result.message } : {}) }]]
        : []
    )));
    return [[path, {
      name: typeof raw.name === 'string' && raw.name ? raw.name : path,
      idleMinutes: minutes(raw.idleMinutes, DEFAULT_IDLE_MINUTES, 1),
      jobs,
      choices,
      scheduledFrom,
      lastResults,
    }]];
  })));
}

/** A document's scheduled jobs as its schedule block declares them now, with what the user chose kept for those it has. */
function synced(previous: ScheduledDocument | undefined, name: string, schedule: ScheduleBlockConfig): ScheduledDocument {
  const ids = new Set(schedule.jobs.map((job) => job.id));
  const kept = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
  return {
    name,
    idleMinutes: previous?.idleMinutes ?? DEFAULT_IDLE_MINUTES,
    jobs: schedule.jobs.map(({ id, name: jobName, timing }) => ({ id, name: jobName, timing })),
    choices: kept(previous?.choices ?? {}),
    scheduledFrom: kept(previous?.scheduledFrom ?? {}),
    lastResults: kept(previous?.lastResults ?? {}),
  };
}

/** Whether the user set a document's jobs up: one is on, or a timing or the wait is their own. Only then is it kept. */
export function inUse(document: ScheduledDocument): boolean {
  return document.idleMinutes !== DEFAULT_IDLE_MINUTES
    || Object.values(document.choices).some((choice) => choice.on || choice.timing !== undefined);
}

/** A document's entry, kept while in use and dropped otherwise; the same settings when nothing changed. */
function stored(documents: ScheduledDocuments, path: string, next: ScheduledDocument): ScheduledDocuments {
  if (!inUse(next)) return withoutScheduledDocument(documents, path);
  const previous = documents[path];
  return previous && JSON.stringify(previous) === JSON.stringify(next) ? documents : { ...documents, [path]: next };
}

/** What the user chose for a document's jobs, as its block declares them: its entry, or every job off when it has none. */
export function scheduledFor(documents: ScheduledDocuments, path: string, name: string, schedule: ScheduleBlockConfig): ScheduledDocument {
  return synced(documents[path], name, schedule);
}

/**
 * A document with a schedule block, opened or saved: its entry, if the user set its jobs up, follows its block (its jobs
 * as declared now; the user's choices kept for those it still has). One the user never set up stays unlisted.
 */
export function withScheduleBlock(documents: ScheduledDocuments, path: string, name: string, schedule: ScheduleBlockConfig): ScheduledDocuments {
  return documents[path] ? stored(documents, path, synced(documents[path], name, schedule)) : documents;
}

/** The user changed a document's jobs (in its block): kept while in use, dropped once nothing of it is theirs. */
export function withScheduleChange(documents: ScheduledDocuments, path: string, name: string, schedule: ScheduleBlockConfig, change: (document: ScheduledDocument) => ScheduledDocument): ScheduledDocuments {
  return stored(documents, path, change(scheduledFor(documents, path, name, schedule)));
}

/** Entries the user no longer uses (every job turned off, in Scheduled jobs) dropped. */
export function withoutUnused(documents: ScheduledDocuments): ScheduledDocuments {
  return Object.fromEntries(Object.entries(documents).filter(([, document]) => inUse(document)));
}

/** A document no longer scheduled: it has no schedule block, or it was archived or deleted. */
export function withoutScheduledDocument(documents: ScheduledDocuments, path: string): ScheduledDocuments {
  if (!(path in documents)) return documents;
  const { [path]: _removed, ...rest } = documents;
  return rest;
}

/** Documents no longer scheduled because what holds them went away: a workspace archived, a folder deleted. */
export function withoutScheduledDocumentsIn(documents: ScheduledDocuments, holds: (path: string) => boolean): ScheduledDocuments {
  const kept = Object.entries(documents).filter(([path]) => !holds(path));
  return kept.length === Object.keys(documents).length ? documents : Object.fromEntries(kept);
}

/** When a job runs: the user's choice, or its block's default. */
export function jobTiming(document: ScheduledDocument, jobId: string): ScheduleTiming {
  return document.choices[jobId]?.timing ?? document.jobs.find((job) => job.id === jobId)?.timing ?? { every: SCHEDULE_MIN_MINUTES };
}

/** A job turned on or off. */
export function withJobOn(document: ScheduledDocument, jobId: string, on: boolean): ScheduledDocument {
  return { ...document, choices: { ...document.choices, [jobId]: { ...document.choices[jobId], on } } };
}

/** When a job runs (an interval never under the minimum); its block's default again when set to it. */
export function withJobTiming(document: ScheduledDocument, jobId: string, timing: ScheduleTiming): ScheduledDocument {
  const next: ScheduleTiming = 'every' in timing
    ? { every: Math.min(SCHEDULE_MAX_MINUTES, Math.max(SCHEDULE_MIN_MINUTES, Math.round(timing.every))) }
    : { at: timing.at, days: [...new Set(timing.days)].sort() };
  const fallback = document.jobs.find((job) => job.id === jobId)?.timing;
  const { timing: _previous, ...choice } = document.choices[jobId] ?? { on: false };
  return { ...document, choices: { ...document.choices, [jobId]: JSON.stringify(next) === JSON.stringify(fallback) ? choice : { ...choice, timing: next } } };
}

/**
 * The first time after `after` (ms) that a time of day ("HH:MM", local) falls on one of `days` (0 is Sunday; none means
 * every day). Built day by day from the calendar, so a daylight-saving change moves nothing.
 */
export function nextTimeOfDay(after: number, at: string, days: number[]): number {
  const [hours, minutesPart] = at.split(':').map(Number);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(after);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutesPart, 0, 0);
    if (candidate.getTime() > after && (!days.length || days.includes(candidate.getDay()))) return candidate.getTime();
  }
  return Number.POSITIVE_INFINITY;
}

/** A job due now: its document's path, its id, and how long past due it is (ms; a job never run is the most overdue). */
export interface DueJob {
  path: string;
  jobId: string;
  overdueMs: number;
}

/**
 * The jobs due at `now`, the most overdue first: each one turned on, its next turn come (a frequency after its last, or
 * its next time of day after it). A time of day missed (Galaxy closed) is due once, until it runs.
 */
export function dueJobs(documents: ScheduledDocuments, now: number): DueJob[] {
  return Object.entries(documents)
    .flatMap(([path, document]) => document.jobs
      .filter((job) => document.choices[job.id]?.on === true)
      .map((job) => {
        const next = nextTurnAt(document, job.id);
        return { path, jobId: job.id, overdueMs: next === null ? Number.POSITIVE_INFINITY : now - next };
      }))
    .filter((job) => job.overdueMs >= 0)
    .sort((left, right) => right.overdueMs - left.overdueMs);
}

/**
 * A job's turn, at `at`: its next counts from then, however this one went. A trigger that failed or a turn skipped is not
 * tried again sooner: when in doubt, a job waits for its next turn rather than running when it isn't expected.
 */
export function withJobResult(document: ScheduledDocument, jobId: string, result: ScheduledJobResult): ScheduledDocument {
  return {
    ...document,
    lastResults: { ...document.lastResults, [jobId]: result },
    scheduledFrom: { ...document.scheduledFrom, [jobId]: result.at },
  };
}

/**
 * When a job's next turn is (ms): a frequency after its schedule last started counting, or its next time of day after
 * that; null when it never has (due now).
 */
export function nextTurnAt(document: ScheduledDocument, jobId: string): number | null {
  const last = document.scheduledFrom[jobId];
  if (last === undefined) return null;
  const timing = jobTiming(document, jobId);
  return 'every' in timing ? last + timing.every * 60_000 : nextTimeOfDay(last, timing.at, timing.days);
}

/** A span of time in words: "3 min", "4 h", "2 days". */
const DAY_MS = 86_400_000;

/**
 * A time as a clock reads it, which stays right however long it is shown (a reader draws again only when something
 * happens): "3:37 PM" today, "Tue 3:37 PM" within the week around it, "Nov 3, 3:37 PM" further off.
 */
export function clockText(at: number, now: number): string {
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (new Date(at).toDateString() === new Date(now).toDateString()) return new Date(at).toLocaleTimeString([], time);
  if (Math.abs(at - now) < 6 * DAY_MS) return new Date(at).toLocaleString([], { weekday: 'short', ...time });
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', ...time });
}

/**
 * A job's last turn and its next, at clock times: "Triggered at 3:37 PM · next at 9:37 PM", "Failed at 3:37 PM: … ·
 * next at 9:37 PM". Its next is said only while it is on; a job off says its last turn, or nothing (its checkbox says it
 * is off).
 */
export function jobTurnText(document: ScheduledDocument, jobId: string, now: number): string {
  const result = document.lastResults[jobId];
  const verb = result?.outcome === 'triggered' ? 'Triggered' : result?.outcome === 'failed' ? 'Failed' : 'Skipped';
  const last = !result ? 'Not triggered yet' : `${verb} at ${clockText(result.at, now)}${result.outcome !== 'triggered' && result.message ? `: ${result.message}` : ''}`;
  if (document.choices[jobId]?.on !== true) return result ? last : '';
  const next = nextTurnAt(document, jobId);
  return `${last} · ${next === null || next <= now ? 'next once you’re idle' : `next at ${clockText(next, now)}`}`;
}

/** How often, in words: "every 6 hours", "every day". */
export function everyText(minutes: number): string {
  const [count, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** When a job runs, in words: "every 6 hours", "daily at 2:00 AM", "weekdays at 2:00 AM", "Mon, Wed at 2:00 AM". */
export function timingText(timing: ScheduleTiming): string {
  if ('every' in timing) return everyText(timing.every);
  const [hours, minutesPart] = timing.at.split(':').map(Number);
  const time = new Date(2000, 0, 1, hours, minutesPart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = timing.days.length === 0 || timing.days.length === 7
    ? 'daily'
    : timing.days.join() === '1,2,3,4,5' ? 'weekdays' : timing.days.map((day) => DAY_NAMES[day]).join(', ');
  return `${days} at ${time}`;
}

/**
 * Applied in a document's schedule block: each job turned on, or whose timing changed while on, counts its schedule from
 * `at`, so its next turn is the next after then (a frequency later, or its next time of day) rather than at once.
 */
export function withChangesApplied(document: ScheduledDocument, next: Pick<ScheduledDocument, 'choices' | 'idleMinutes'>, at: number): ScheduledDocument {
  const applied = { ...document, ...next };
  const restarted = applied.jobs
    .filter((job) => applied.choices[job.id]?.on && (document.choices[job.id]?.on !== true || JSON.stringify(jobTiming(document, job.id)) !== JSON.stringify(jobTiming(applied, job.id))))
    .map((job) => job.id);
  return restarted.length ? { ...applied, scheduledFrom: { ...applied.scheduledFrom, ...Object.fromEntries(restarted.map((id) => [id, at])) } } : applied;
}

/**
 * A schedule block's status, for its header: the job that runs next (its name too, when the block has several jobs on),
 * its last turn and its next; empty with no job on.
 */
export function scheduleStatusText(document: ScheduledDocument, now: number): string {
  const on = document.jobs.filter((job) => document.choices[job.id]?.on);
  const next = on.map((job) => ({ job, at: nextTurnAt(document, job.id) ?? Number.NEGATIVE_INFINITY })).sort((left, right) => left.at - right.at)[0];
  if (!next) return '';
  const text = jobTurnText(document, next.job.id, now);
  return on.length > 1 ? `${next.job.name}: ${text}` : text;
}
