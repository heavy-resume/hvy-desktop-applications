import { saveAppSettings } from '../backend';
import { state } from '../state';
import type { FileKey } from '../runtimeDocuments';
import type { ScheduledDocuments } from './scheduleSettings';

/** The scheduled documents in Galaxy's app settings, as they are now. */
export function scheduledDocuments(): ScheduledDocuments<FileKey> {
  return state.appSettings.scheduledDocuments;
}

/**
 * Changes the scheduled documents and saves the app settings. What is held stays what was changed, not the saved copy
 * coming back: a second change made before the first save answers would otherwise be undone by it.
 */
export function updateScheduledDocuments(change: (documents: ScheduledDocuments<FileKey>) => ScheduledDocuments<FileKey>): void {
  const next = change(state.appSettings.scheduledDocuments);
  if (next === state.appSettings.scheduledDocuments) return;
  state.appSettings = { ...state.appSettings, scheduledDocuments: next };
  void saveAppSettings(state.appSettings);
}

let runNow: (file: FileKey, jobId: string) => Promise<void> = async () => undefined;

/** The app's scheduler (scheduledJobs.ts) runs a job when asked: kept here, as a document's block can't import the app. */
export function setScheduledJobRunner(run: (file: FileKey, jobId: string) => Promise<void>): void {
  runNow = run;
}

/** A schedule block's Run now: the job triggered at once, as if its button were pressed, without waiting for idle. */
export function runScheduledJobNow(file: FileKey, jobId: string): Promise<void> {
  return runNow(file, jobId);
}
