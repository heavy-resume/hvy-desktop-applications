import type { VisualDocument } from '../../heavy-file-format/src/types';
import { closeCurrentDocument, documentSessions, rerender, saveCurrentDocument, selectDocumentTab } from './main';
import { state } from './state';
import { documentAutomationFor } from './webAutomation/app';
import { SCHEDULE_PLUGIN_ID } from './webAutomation/configs';
import { readWebAutomationBlocks } from './webAutomation/documentBlocks';
import { dueJobs, withJobResult, type ScheduledJobResult } from './webAutomation/scheduleSettings';
import { scheduledDocuments, setScheduledJobRunner, updateScheduledDocuments } from './webAutomation/scheduleStore';

/**
 * Scheduled jobs (docs/job-search/12-scheduled-jobs.md): a document's job is its script, triggered on a timer as if its
 * button were pressed, once. While Galaxy is open, once the user has been idle in it for the document's wait, the job's
 * document is opened as a tab (or switched to), its script runs there, and Galaxy goes back to the tab the user was on.
 * That is the job's turn: what the script started is the document's. The tab is left marked busy until nothing is left
 * of that and nothing has happened in it for a while; a tab the job opened is then saved and closed, unless the user
 * took it over.
 */

/** How often what is due is looked at. */
const TICK_MS = 60_000;
/** How often a running job's document is looked at, for being idle or taken over. */
const WATCH_MS = 15_000;
/** A job's document is idle once nothing has happened in it, and nothing it started is left, for this long. */
const DOCUMENT_IDLE_MS = 5 * 60_000;
/** A job waiting this long for the user to be idle is skipped until its next turn. */
const WAIT_FOR_IDLE_MS = 30 * 60_000;
/** A job's document that never goes idle is marked with a problem after this long, and left as it is. */
const NEVER_IDLE_MS = 4 * 60 * 60_000;

/** When the user last typed, clicked, or scrolled in Galaxy. */
let lastInputAt = Date.now();
/**
 * What Galaxy is doing with tabs for scheduled jobs now: a job being triggered, or a job's tab being saved and closed.
 * One at a time across the app, so its tab switches never interleave; waiting for a tab to settle holds nothing.
 */
let running: Promise<void> | null = null;
/** When each due job started waiting for the user to be idle, by its document's path and its id. */
const waitingSince = new Map<string, number>();
/** Galaxy's own tab switches while running a job, which are not the user taking a tab over. */
let switching = false;

/** Starts the timer, and listens for the user's input to know when they are idle. */
export function startScheduledJobs(): void {
  setScheduledJobRunner(runNow);
  const input = () => {
    lastInputAt = Date.now();
  };
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(type, input, { capture: true, passive: true });
  window.setInterval(() => void tick(), TICK_MS);
}

function userIdleFor(ms: number): boolean {
  return Date.now() - lastInputAt >= ms;
}

function record(path: string, jobId: string, result: ScheduledJobResult): void {
  updateScheduledDocuments((documents) => (documents[path] ? { ...documents, [path]: withJobResult(documents[path], jobId, result) } : documents));
}

/**
 * The longest overdue job, triggered once the user is idle; skipped after waiting long for that. Jobs run one after
 * another (Settings, "Jobs at once"): the next waits until fewer than that many jobs' tabs are busy, so many jobs
 * overdue at once (Galaxy was closed) don't all run together. Each one's next turn counts from when it triggered.
 */
async function tick(): Promise<void> {
  const busy = Object.values(state.scheduledJobRuns).filter((run) => !run.problem).length;
  if (running || busy >= state.appSettings.scheduledJobsAtOnce) return;
  const now = Date.now();
  const [next] = dueJobs(scheduledDocuments(), now);
  if (!next) return;
  const scheduled = scheduledDocuments()[next.path];
  const key = `${next.path}\u0000${next.jobId}`;
  if (!userIdleFor(scheduled.idleMinutes * 60_000)) {
    const since = waitingSince.get(key) ?? now;
    waitingSince.set(key, since);
    if (now - since >= WAIT_FOR_IDLE_MS) {
      waitingSince.delete(key);
      record(next.path, next.jobId, { at: now, outcome: 'skipped', message: 'You were using Galaxy.' });
    }
    return;
  }
  waitingSince.delete(key);
  // Its tab left with a problem (it couldn't be saved, what it started never settled): not pressed again on top of that.
  if (state.scheduledJobRuns[next.path]?.problem) {
    record(next.path, next.jobId, { at: now, outcome: 'skipped', message: 'Its tab has a problem from its last turn.' });
    return;
  }
  running = runJob(next.path, next.jobId).finally(() => {
    running = null;
  });
}

/**
 * Run now (a schedule block): the job triggered at once, whether or not the user is idle, as if its button were
 * pressed; only after any tab switching Galaxy is doing for another job. It is the job's turn: its next counts from it.
 */
async function runNow(path: string, jobId: string): Promise<void> {
  while (running) await running;
  running = runJob(path, jobId).finally(() => {
    running = null;
  });
  await running;
}

/** Switches tabs as Galaxy, not the user: not taken as the user taking a job's tab over. */
async function switchTo(path: string): Promise<void> {
  switching = true;
  try {
    await selectDocumentTab(path);
  } finally {
    switching = false;
  }
}

function setBusy(path: string, busy: { job: string; problem?: string } | null): void {
  if (busy) state.scheduledJobRuns = { ...state.scheduledJobRuns, [path]: busy };
  else {
    const { [path]: _done, ...rest } = state.scheduledJobRuns;
    state.scheduledJobRuns = rest;
  }
  rerender({ preserveMountedDocument: true });
}

/** Triggers a document's job: as if its button were pressed in it, then back to the user's tab. Its tab is watched apart. */
async function runJob(path: string, jobId: string): Promise<void> {
  const startedAt = Date.now();
  const previous = state.document?.versionId ?? null;
  const wasActive = state.document?.source.path === path;
  const wasOpen = wasActive || [...documentSessions.values()].some((session) => session.source.path === path);
  const fail = (message: string) => record(path, jobId, { at: startedAt, outcome: 'failed', message });
  try {
    if (!wasActive) {
      const open = [...documentSessions.values()].find((session) => session.source.path === path);
      await switchTo(open?.versionId ?? path);
    }
  } catch (error) {
    fail(`Its document couldn’t be opened: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const document = state.document?.source.path === path ? state.document.mounted?.document as VisualDocument | undefined : undefined;
  const versionId = state.document?.versionId ?? path;
  const back = async () => {
    if (!wasActive && previous && previous !== versionId) await switchTo(previous);
  };
  if (!document) {
    fail('Its document couldn’t be opened.');
    await back();
    return;
  }
  const schedule = readWebAutomationBlocks(document).schedules[0];
  const job = schedule?.config.jobs.find((candidate) => candidate.id === jobId);
  const automation = documentAutomationFor(document);
  if (!schedule || !job || !automation) {
    fail('Its document no longer has this job.');
    await back();
    return;
  }
  if (automation.pluginAuthorization(SCHEDULE_PLUGIN_ID) !== 'enabled') {
    fail('Schedule isn’t allowed in this file yet: open it and allow it.');
    await back();
    return;
  }
  const paused = schedule.config.paused[job.id] ?? schedule.config.paused['*'];
  if (paused) {
    record(path, jobId, { at: startedAt, outcome: 'skipped', message: `Paused: ${paused}` });
    await back();
    return;
  }
  automation.setUnattended(true);
  setBusy(path, { job: job.name });
  // As a form's trigger runs its script (heavy-file-format's form reader): the block's own script, not started by the user.
  const { runUserScript } = await import('../../heavy-file-format/src/plugins/scripting/wrapper');
  const result = await runUserScript({
    document,
    source: schedule.config.scripts[job.script],
    componentId: `${schedule.blockId}:${job.script}:schedule`,
    libraries: schedule.config.scriptLibraries,
    startedByUser: false,
  });
  // Its turn, triggered: what the script started is the document's from here.
  // A failure's one line (heavy-file-format's error, with the script's line), not its traceback.
  record(path, jobId, result.ok ? { at: startedAt, outcome: 'triggered' } : { at: startedAt, outcome: 'failed', message: result.error ?? 'Its script failed.' });
  await back();
  void watchUntilIdle(path, versionId, job.name, startedAt, !wasOpen, automation);
}

/**
 * Waits for the job's document to be idle (nothing left of what its script started, nothing happening in it for a
 * while), then lets the tab go: one the job opened, not taken over by the user, is saved and closed while the user is
 * idle. Only the tab says how that went; the job's turn was over once triggered.
 */
async function watchUntilIdle(
  path: string,
  versionId: string,
  jobName: string,
  startedAt: number,
  openedByJob: boolean,
  automation: NonNullable<ReturnType<typeof documentAutomationFor>>,
): Promise<void> {
  let takenOver = false;
  const end = (problem?: string) => {
    automation.setUnattended(false);
    setBusy(path, problem ? { job: jobName, problem } : null);
  };
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, WATCH_MS));
    // The user working in the job's tab takes it over: it is theirs, left as any open document is.
    if (!switching && state.document?.source.path === path && lastInputAt > startedAt) takenOver = true;
    const open = state.document?.source.path === path || [...documentSessions.values()].some((session) => session.source.path === path);
    // Closed by the user: nothing is left to end.
    if (!open) {
      end();
      return;
    }
    const { outstanding, lastActivityAt } = automation.automation.activity();
    const idle = outstanding === 0 && Date.now() - lastActivityAt >= DOCUMENT_IDLE_MS;
    if (!idle) {
      if (Date.now() - startedAt >= NEVER_IDLE_MS) {
        end('what it started didn’t finish');
        return;
      }
      continue;
    }
    if (!openedByJob || takenOver) {
      end();
      return;
    }
    // Saved and closed as the user would, with Save and Close, only while they aren't using Galaxy, and not while Galaxy
    // is switching tabs for another job.
    const scheduled = scheduledDocuments()[path];
    if (running || !userIdleFor((scheduled?.idleMinutes ?? 5) * 60_000)) continue;
    running = saveAndClose(path, versionId, end).finally(() => {
      running = null;
    });
    await running;
    return;
  }
}

/** A job's tab, idle and not taken over: saved and closed, then back to the tab the user was on. */
async function saveAndClose(path: string, versionId: string, end: (problem?: string) => void): Promise<void> {
  const previous = state.document?.versionId ?? null;
  try {
    await switchTo(versionId);
    await saveCurrentDocument();
    if (state.document?.source.path === path && !state.document.dirty && !state.saveConflictDialogOpen) {
      await closeCurrentDocument({ discard: true });
      end();
    } else {
      end('couldn’t be saved, so its tab was left open');
    }
  } finally {
    if (previous && previous !== versionId) await switchTo(previous);
  }
}
