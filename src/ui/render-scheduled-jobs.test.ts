import { describe, expect, it } from 'vitest';
import { builtInPlugins } from 'virtual:hvy-built-in-plugins';
import { pluginAcceptanceKey } from '../pluginManager';
import { renderScheduledJobsDialog, scheduledJobKey } from './render-scheduled-jobs';
import { fileKeyForPath } from '../runtimeDocuments';
import type { AppState } from '../state';
import type { ScheduledDocument } from '../webAutomation/scheduleSettings';

const schedule = builtInPlugins.find((plugin) => plugin.id === 'galaxy.schedule')!;
const scheduled = (overrides: Partial<ScheduledDocument> = {}): ScheduledDocument => ({
  name: 'jobs.hvy', idleMinutes: 5,
  jobs: [{ id: 'fetch-due', name: 'Fetch due pages', timing: { every: 360 } }, { id: 'tidy', name: 'Tidy up', timing: { every: 60 } }],
  choices: { 'fetch-due': { on: true, timing: { every: 1440 } } }, scheduledFrom: {}, lastResults: {},
  ...overrides,
});
// Given by path, held by file reference, as settings are once loaded.
const dialog = (documents: Record<string, ScheduledDocument>, options: { allowed?: boolean; draft?: Record<string, boolean> } = {}) => renderScheduledJobsDialog({
  scheduledJobsDialogOpen: true,
  scheduledJobsDraft: options.draft ?? {},
  scheduledJobWaits: {},
  appSettings: {
    scheduledDocuments: Object.fromEntries(Object.entries(documents).map(([path, document]) => [fileKeyForPath(path), document])),
    pluginAcceptances: options.allowed === false ? {} : Object.fromEntries(Object.keys(documents).map((path) => [fileKeyForPath(path), [pluginAcceptanceKey(schedule)]])),
    pluginPolicies: {},
  },
} as unknown as AppState);

describe('Scheduled jobs', () => {
  it('lists only the jobs that are on, each with a link to its document, its checkbox to the left of its name', () => {
    const html = dialog({ '/work/jobs.hvy': scheduled() });
    expect(html).toMatch(/<input type="checkbox" data-action="set-scheduled-job-on" data-path="\/work\/jobs.hvy" data-job="fetch-due" checked>\s*<span>Fetch due pages<\/span>/);
    expect(html).not.toContain('Tidy up');
    expect(html).toContain('data-action="open-scheduled-document" data-path="/work/jobs.hvy" title="/work/jobs.hvy">jobs.hvy</button>');
    expect(html).toContain('every day · Not triggered yet · next once you’re idle');
    expect(html).not.toContain('scheduled-jobs-not-allowed');
  });

  it('shows a job turned off and not saved yet still listed, unchecked, and says when its file hasn\'t allowed Schedule', () => {
    const html = dialog({ '/work/jobs.hvy': scheduled() }, { allowed: false, draft: { [scheduledJobKey(fileKeyForPath('/work/jobs.hvy'), 'fetch-due')]: false } });
    expect(html).toMatch(/data-job="fetch-due">\s*<span>Fetch due pages/);
    expect(html).toContain('Schedule isn’t allowed in this file yet: open it and allow it.');
  });

  it('says where jobs are turned on when none is', () => {
    expect(dialog({})).toContain('No jobs are on. Turn one on in its document’s Scheduled jobs block.');
  });
});
