import type { AppState } from '../state';
import type { BackgroundActivity, BackgroundQueueSummary, BackgroundRunSummary } from '../webAutomation/app';
import { escapeAttr, escapeHtml } from './shared';

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * What the toolbar indicator says, or null while nothing runs or waits in the background: `short` is what it shows,
 * a word or two so the document name keeps its room, and `full` its tooltip.
 */
export interface BackgroundActivityLabel {
  short: string;
  full: string;
}

export function backgroundActivityLabel(activity: BackgroundActivity | null): BackgroundActivityLabel | null {
  if (!activity) return null;
  const busy = activity.workers.flatMap(({ label }) => (label ? [label] : []));
  const queues = activity.documents.flatMap(({ queues: documentQueues }) => documentQueues);
  const runs = activity.documents.flatMap(({ runs: documentRuns }) => documentRuns);
  const queued = queues.reduce((total, queue) => total + queue.queued + queue.retrying, 0);
  const paused = queues.filter((queue) => queue.paused || queue.awaitingResume).length;
  const failed = queues.reduce((total, queue) => total + queue.failed, 0);
  const details = [
    activity.waitingJobs.length ? `${activity.waitingJobs.length} waiting` : '',
    queued ? `${queued} queued` : '',
    paused ? `${plural(paused, 'queue')} paused` : '',
    failed ? `${failed} failed` : '',
  ].filter(Boolean);
  const main = busy.length === 1 ? busy[0]
    : busy.length ? `${busy.length} running`
      : runs.length ? (runs.length === 1 ? `${runs[0].name}: collecting` : `${runs.length} collecting`)
        : details.shift();
  if (!main) return null;
  const short = busy.length || runs.length ? 'Working' : queued ? `${queued} queued` : paused ? 'Paused' : main;
  return { short, full: `Background: ${main}${details.length ? ` (${details.join(', ')})` : ''}` };
}

/** In the toolbar's status area, before the save state, while background work runs or waits. Opens the panel. */
export function renderBackgroundActivityIndicator(state: AppState): string {
  const label = state.backgroundActivityLabel;
  if (!label) return '';
  return `<button class="hvy-galaxy-button background-activity-indicator" type="button" data-action="open-background-activity" title="${escapeAttr(label.full)}" aria-label="${escapeAttr(label.full)}"><span class="background-activity-indicator-dot" aria-hidden="true"></span>${escapeHtml(label.short)}</button>`;
}

function documentName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function documentHeading(state: AppState, path: string): string {
  const tab = state.documentTabs.find((candidate) => candidate.sourcePath === path);
  const elsewhere = tab && state.document?.source.path !== path;
  return `
    <div class="background-activity-document">
      <strong title="${escapeAttr(path)}">${escapeHtml(documentName(path))}</strong>
      ${elsewhere ? `<button class="hvy-galaxy-button" type="button" data-action="select-document-tab" data-path="${escapeAttr(tab.versionId)}">Go to document</button>` : ''}
    </div>`;
}

function runRow(path: string, run: BackgroundRunSummary): string {
  const status = run.status === 'needs-attention' ? 'needs you' : 'collecting';
  return `
    <li class="background-activity-row">
      <span class="background-activity-row-text">${escapeHtml(run.name)}: ${status}, ${run.collected} new, ${run.skipped} already listed${run.problems ? `, ${plural(run.problems, 'problem')}` : ''}</span>
      <button class="hvy-galaxy-button" type="button" data-action="stop-background-run" data-path="${escapeAttr(path)}" data-run-id="${escapeAttr(run.runId)}">Stop</button>
    </li>`;
}

function queueRow(path: string, queue: BackgroundQueueSummary): string {
  const counts = [
    queue.running ? `${queue.running} running` : '',
    queue.queued ? `${queue.queued} queued` : '',
    queue.retrying ? `${queue.retrying} retrying` : '',
    queue.failed ? `${queue.failed} failed` : '',
  ].filter(Boolean).join(', ');
  const paused = queue.awaitingResume ? 'waiting for Resume' : queue.paused ? `paused${queue.pauseReason ? ` (${queue.pauseReason.replaceAll('_', ' ')})` : ''}` : '';
  const action = queue.paused || queue.awaitingResume ? 'resume' : 'pause';
  return `
    <li class="background-activity-row">
      <span class="background-activity-row-text">${escapeHtml(queue.queueId)}: ${escapeHtml(counts)}${paused ? ` · ${escapeHtml(paused)}` : ''}</span>
      <button class="hvy-galaxy-button" type="button" data-action="${action}-background-queue" data-path="${escapeAttr(path)}" data-queue-id="${escapeAttr(queue.queueId)}">${action === 'resume' ? 'Resume' : 'Pause'}</button>
    </li>`;
}

function time(at: number): string {
  const date = new Date(at);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Every piece of background work across open documents: the browser workers and the jobs waiting for one, each
 * document's collection runs and queues with their controls, and the latest events, so a stall says what it was doing.
 */
export function renderBackgroundActivityDialog(state: AppState): string {
  if (!state.backgroundActivityOpen) return '';
  const activity = state.backgroundActivity ?? { workers: [], waitingJobs: [], duplicates: [], documents: [], events: [] };
  const duplicates = new Set(activity.duplicates);
  const duplicate = (label: string) => (duplicates.has(label) ? ' <span class="background-activity-duplicate">same call twice</span>' : '');
  const workers = activity.workers.map((worker) => `
    <li class="background-activity-row">
      <span class="background-activity-row-text">${escapeHtml(worker.profile)} · ${worker.kind === 'api' ? 'API' : 'collection'} · ${worker.label ? `${escapeHtml(worker.label)}${duplicate(worker.label)}` : 'idle'}</span>
    </li>`).join('');
  const waiting = activity.waitingJobs.map((job) => `
    <li class="background-activity-row is-waiting">
      <span class="background-activity-row-text">Waiting: ${escapeHtml(job.profile)} · ${job.kind === 'api' ? 'API' : 'collection'} · ${escapeHtml(job.label)}${duplicate(job.label)}</span>
    </li>`).join('');
  const withRuns = activity.documents.filter(({ runs }) => runs.length);
  const withQueues = activity.documents.filter(({ queues }) => queues.length);
  const canPauseAll = withQueues.some(({ queues }) => queues.some((queue) => !queue.paused && !queue.awaitingResume));
  const events = activity.events.map((event) => `
    <li class="background-activity-event">
      <time class="background-activity-event-time">${time(event.at)}</time>
      <span class="background-activity-event-source">${escapeHtml(event.source)}</span>
      <span class="background-activity-event-message">${escapeHtml(event.message)}</span>
    </li>`).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog background-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="backgroundActivityTitle">
        <h2 id="backgroundActivityTitle">Background activity</h2>
        <section class="background-activity-section">
          <h3 class="background-activity-heading">Now</h3>
          ${workers || waiting ? `<ul class="background-activity-list">${workers}${waiting}</ul>` : '<p class="dialog-note">No browser workers yet.</p>'}
        </section>
        <section class="background-activity-section">
          <h3 class="background-activity-heading">Collections</h3>
          ${withRuns.length ? withRuns.map(({ path, runs }) => `${documentHeading(state, path)}<ul class="background-activity-list">${runs.map((run) => runRow(path, run)).join('')}</ul>`).join('') : '<p class="dialog-note">No collection running.</p>'}
        </section>
        <section class="background-activity-section">
          <div class="background-activity-section-header">
            <h3 class="background-activity-heading">Queues</h3>
            ${canPauseAll ? '<button class="hvy-galaxy-button" type="button" data-action="pause-all-background-queues">Pause all</button>' : ''}
          </div>
          ${withQueues.length ? withQueues.map(({ path, queues }) => `${documentHeading(state, path)}<ul class="background-activity-list">${queues.map((queue) => queueRow(path, queue)).join('')}</ul>`).join('') : '<p class="dialog-note">No queued work.</p>'}
        </section>
        <section class="background-activity-section">
          <h3 class="background-activity-heading">Recent activity</h3>
          ${events ? `<ol class="background-activity-events">${events}</ol>` : '<p class="dialog-note">Nothing yet.</p>'}
        </section>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button primary-button" type="button" data-action="close-background-activity">Close</button>
        </div>
      </section>
    </div>`;
}
