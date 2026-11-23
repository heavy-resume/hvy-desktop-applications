import type { NotificationClick } from './backend';
import { documentSessions } from './main';
import { runtimeDocumentById } from './runtimeDocuments';
import { switchAsUser } from './scheduledJobs';
import { state } from './state';

/**
 * A notification clicked (plugins/notifications.ts), once Galaxy's window is raised: its document brought forward, in
 * its tab if it has one (a job may still be running in it), or opened again from its file (a scheduled job's tab is
 * closed once it is done), then shown at the notification's target. A document not saved yet has nothing to open.
 */
export async function openNotificationClick(click: NotificationClick): Promise<void> {
  // The tab it has, as a job finds its document's (scheduledJobs.ts): the current one isn't among the sessions.
  const open = state.document?.documentId === click.documentId
    ? state.document
    : [...documentSessions.values()].find((session) => session.documentId === click.documentId);
  const path = open?.versionId ?? runtimeDocumentById(click.documentId)?.path ?? click.path;
  if (!path) return;
  await switchAsUser(path);
  if (click.target) state.document?.mounted?.mount.navigateToTarget(click.target);
}
