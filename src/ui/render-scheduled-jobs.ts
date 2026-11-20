import { builtInPlugins } from 'virtual:hvy-built-in-plugins';
import { builtInPluginPolicy, pluginAcceptanceKey } from '../pluginManager';
import type { AppState } from '../state';
import { SCHEDULE_PLUGIN_ID } from '../webAutomation/configs';
import { pathForFileKey, runtimeDocumentById, type FileKey } from '../runtimeDocuments';
import { jobTiming, jobTurnText, timingText, type ScheduledDocument } from '../webAutomation/scheduleSettings';
import { scheduledJobKey } from '../webAutomation/scheduleStore';
import { renderDialog } from './dialog';
import { escapeAttr, escapeHtml } from './shared';

export { scheduledJobKey };

/**
 * Scheduled jobs (Plugins menu): the jobs that are on, in every document, each with a link to open its document. A
 * job is turned on in its document's schedule block; here it is turned off. Changes are held until Save, and Cancel
 * drops them.
 */
export function renderScheduledJobsDialog(state: AppState): string {
  if (!state.scheduledJobsDialogOpen) return '';
  // Whether a file has allowed Schedule: a job turned on there fails at its turn otherwise.
  const schedule = builtInPlugins.find((plugin) => plugin.id === SCHEDULE_PLUGIN_ID);
  const policy = schedule ? builtInPluginPolicy(state.appSettings, schedule) : 'disabled';
  const notAllowed = (file: FileKey) => (policy === 'disabled'
    ? 'Schedule is disabled in Settings.'
    : policy === 'conditional' && schedule && !(state.appSettings.pluginAcceptances[file] ?? []).includes(pluginAcceptanceKey(schedule))
      ? 'Schedule isn’t allowed in this file yet: open it and allow it.'
      : null);
  const now = Date.now();
  // Each file listed where it is now, by its name now.
  const jobs = (Object.entries(state.appSettings.scheduledDocuments) as Array<[FileKey, ScheduledDocument]>)
    .flatMap(([file, document]) => {
      const name = runtimeDocumentById(file)?.name ?? document.name;
      return document.jobs.filter((job) => document.choices[job.id]?.on).map((job) => ({ file, path: pathForFileKey(file), name, document, job }));
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.job.name.localeCompare(right.job.name));
  const body = jobs.length
    ? `<div class="scheduled-jobs-list">${jobs.map(({ file, path, name, document, job }) => {
      const on = state.scheduledJobsDraft[scheduledJobKey(file, job.id)] ?? true;
      const problem = notAllowed(file);
      return `
        <div class="scheduled-jobs-job">
          <label class="checkbox-row">
            <input type="checkbox" data-action="set-scheduled-job-on" data-path="${escapeAttr(path)}" data-job="${escapeAttr(job.id)}"${on ? ' checked' : ''}>
            <span>${escapeHtml(job.name)}</span>
          </label>
          <button class="hvy-galaxy-button scheduled-jobs-document-link" type="button" data-action="open-scheduled-document" data-path="${escapeAttr(path)}" title="${escapeAttr(path)}">${escapeHtml(name)}</button>
          <span class="scheduled-jobs-detail">${escapeHtml(`${timingText(jobTiming(document, job.id))} · ${jobTurnText(document, job.id, now, state.scheduledJobWaits[scheduledJobKey(file, job.id)])}`)}</span>
          ${problem ? `<p class="dialog-note scheduled-jobs-not-allowed" data-state="error">${escapeHtml(problem)}</p>` : ''}
        </div>`;
    }).join('')}</div>`
    : '<p class="dialog-note">No jobs are on. Turn one on in its document’s Scheduled jobs block.</p>';
  return renderDialog({
    className: 'scheduled-jobs-dialog',
    title: 'Scheduled jobs',
    note: 'Jobs run while Galaxy is open, once you haven’t used it for a few minutes.',
    body,
    actions: `<button class="hvy-galaxy-button" type="button" data-action="close-scheduled-jobs">Cancel</button>
      <button class="hvy-galaxy-button primary-button" type="button" data-action="save-scheduled-jobs"${jobs.length ? '' : ' disabled'}>Save</button>`,
  });
}
