import type { HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
import { state } from '../state';
import { subscribeWebAutomation } from '../webAutomation/app';
import type { AuthorizationReview } from '../webAutomation/authorization';
import { readCollectionBlockConfig, readQueueBlockConfig, readWebApiBlockConfig } from '../webAutomation/configs';
import { createWebAutomationPlugins, resolveDocumentAutomation } from '../webAutomation/documentAutomation';
import { errorMessage } from '../webAutomation/errors';
import type { QueueEntry } from '../webAutomation/queue';
import type { DocumentAutomationLookup } from '../webAutomation/scripting';
import { capabilityOrigin, type WebApiCapability } from '../webAutomation/webApi';
import { button, buildProfileControls, selectedProfile } from './webCapabilities';
import './webCapabilities.css';
import './webAutomation.css';

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className ? `hvy-web-automation-text ${className}` : 'hvy-web-automation-text';
  element.textContent = text;
  return element;
}

function heading(text: string): HTMLElement {
  const element = document.createElement('strong');
  element.textContent = text;
  return element;
}

function status(text: string): HTMLElement {
  const element = paragraph(text, 'hvy-web-automation-status');
  element.setAttribute('role', 'status');
  return element;
}

function actions(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'hvy-web-automation-actions';
  row.append(...buttons);
  return row;
}

/**
 * A reader that rerenders from the automation's published state: on every
 * automation event, and after the reader's own actions. Rendering opens the
 * document's automation, inside the document's state runtime.
 */
function reader(ctx: HvyPluginContext, render: (root: HTMLElement, lookup: DocumentAutomationLookup, sync: () => void) => void): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-web-capability hvy-web-automation';
  const lookup = resolveDocumentAutomation(ctx);
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    root.replaceChildren();
    render(root, lookup, sync);
  };
  const unsubscribe = subscribeWebAutomation(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  });
  sync();
  return { element: root, refresh: sync, unmount: unsubscribe };
}

function reviewReason(review: AuthorizationReview): string {
  if (review.reason === 'profile-changed') return 'You’re seeing this again because a different browser profile is selected.';
  if (review.reason === 'capability-changed') return `You’re seeing this again because what this file does with the service changed (${review.changedCategories.join(', ')}).`;
  return 'You’re seeing this because this file has not used this service with this browser profile before.';
}

/** The service approval: what this file does with your account there. Explicit modal, as for Galaxy's other web capabilities. */
function openServiceApproval(lookup: DocumentAutomationLookup, capability: WebApiCapability, onAllowed: () => void): void {
  const profile = selectedProfile(capability);
  if (!profile || !state.document) return;
  const review = lookup.automation.reviewWebApi(capability);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  const dialog = document.createElement('section');
  dialog.className = 'dialog hvy-web-authorization-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Allow ${capability.name}`);
  const title = document.createElement('h2');
  title.textContent = `Use “${capability.name}” as you?`;
  const details = document.createElement('dl');
  const rows: Array<[string, string]> = [
    ['Document', state.document.source.name],
    ['Browser profile', profile.name],
    ['Service', new URL(capability.pageUrl).host],
    ['Calls', capability.endpoints.map((endpoint) => endpoint.name).join(', ')],
    ...(capability.storageOrigins?.length ? [['Downloads files from', capability.storageOrigins.map((origin) => new URL(origin).host).join(', ')] as [string, string]] : []),
  ];
  for (const [term, description] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description;
    details.append(dt, dd);
  }
  const note = paragraph('Calls are made as your signed-in account. Your session stays in the browser profile; what this file sends and stores is in the document.');
  const row = document.createElement('div');
  row.className = 'dialog-actions';
  const cancel = button('Cancel');
  const allow = button('Allow', true);
  const close = () => backdrop.remove();
  cancel.addEventListener('click', close);
  allow.addEventListener('click', () => {
    lookup.automation.authorizeWebApi(capability);
    close();
    onAllowed();
  });
  row.append(cancel, allow);
  dialog.append(title, paragraph(reviewReason(review), 'hvy-web-authorization-reason'), details, note, row);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  allow.focus();
}

const webApiReader: HvyPluginFactory = (ctx) => {
  // A probe failure is shown until the user acts again.
  let probeError = '';
  const probing = new Set<string>();
  return reader(ctx, (root, lookup, sync) => {
    const result = readWebApiBlockConfig(ctx.block.schema.pluginConfig);
    if (!result.ok) {
      root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
      return;
    }
    const capability = result.value.capability;
    root.append(heading(capability.name), paragraph(`Signed-in service at ${new URL(capability.pageUrl).host}.`), buildProfileControls(capability, sync));
    const profile = selectedProfile(capability);
    if (!profile) return;
    if (lookup.automation.reviewWebApi(capability).reason !== 'authorized') {
      const review = button('Review and allow', true);
      review.addEventListener('click', () => openServiceApproval(lookup, capability, sync));
      root.append(actions(review));
      return;
    }
    const session = lookup.automation.getState().sessions.find((candidate) => candidate.origin === capabilityOrigin(capability) && candidate.profileId === profile.id);
    const key = `${capability.capabilityId}\0${profile.id}`;
    if (!session || session.status === 'unknown') {
      if (!probing.has(key)) {
        probing.add(key);
        lookup.automation.probeSession(capability).catch((error: unknown) => {
          probeError = errorMessage(error);
        }).finally(sync);
      }
      root.append(status(probeError || 'Checking your account…'));
      return;
    }
    probing.delete(key);
    const signIn = button('Sign in', true);
    signIn.addEventListener('click', () => {
      probeError = '';
      void lookup.automation.beginSignIn(capability).catch((error: unknown) => {
        probeError = errorMessage(error);
        sync();
      });
    });
    const signOut = button('Sign out');
    signOut.addEventListener('click', () => void lookup.automation.signOut(capability).finally(sync));
    if (session.status === 'signed-in') root.append(status(`Signed in as ${session.accountName ?? 'your account'}.`), actions(signOut));
    else if (session.status === 'pending-login') root.append(status('Finish signing in in the browser window.'), actions(signIn));
    else root.append(status('Not signed in.'), actions(signIn));
    const error = probeError || session.error;
    if (error) root.append(paragraph(error, 'hvy-web-error'));
  });
};

const RUN_STATUS: Record<string, string> = {
  running: 'Collecting',
  'needs-attention': 'Needs your attention',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
};

const collectionReader: HvyPluginFactory = (ctx) => reader(ctx, (root, lookup, sync) => {
  const result = readCollectionBlockConfig(ctx.block.schema.pluginConfig);
  if (!result.ok) {
    root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
    return;
  }
  const collection = result.value.collection;
  const hosts = [...new Set(collection.startUrls.map((url) => new URL(url).host))].join(', ');
  root.append(heading(collection.name), paragraph(`Collects from ${hosts}.`), buildProfileControls(collection, sync));
  const run = lookup.automation.getState().runs.filter((candidate) => candidate.capabilityId === collection.capabilityId).at(-1);
  if (!run) return;
  const counts = `${run.collected} new, ${run.skipped} already listed, ${run.problems} with problems`;
  root.append(status(`${RUN_STATUS[run.status]}: ${counts}${run.status === 'running' ? ` (page ${run.page})` : ''}.`));
  if (run.status === 'running') {
    const stop = button('Stop');
    stop.addEventListener('click', () => lookup.automation.stopCollection(run.runId));
    root.append(actions(stop));
  } else if (run.status === 'needs-attention' && run.attention) {
    root.append(paragraph(`${run.attention.reason} at ${new URL(run.attention.url).host}.`));
    const show = button('Show', true);
    show.addEventListener('click', () => void lookup.automation.showAttention(run.runId));
    const resume = button('Resume');
    resume.addEventListener('click', () => lookup.automation.resumeAttention(run.runId));
    const stop = button('Stop');
    stop.addEventListener('click', () => lookup.automation.stopCollection(run.runId));
    root.append(actions(show, resume, stop));
  }
  if (run.error) root.append(paragraph(run.error, 'hvy-web-error'));
});

const PAUSE_REASONS: Record<string, string> = {
  not_authenticated: 'Paused until you sign in again.',
  not_authorized: 'Paused until the service is allowed in this file.',
  paused: 'Paused.',
};

const queueReader: HvyPluginFactory = (ctx) => reader(ctx, (root, lookup, sync) => {
  const result = readQueueBlockConfig(ctx.block.schema.pluginConfig);
  if (!result.ok) {
    root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
    return;
  }
  const { queueId } = result.value;
  const queue = lookup.automation.getState().queues[queueId];
  if (!queue) return;
  const count = (statuses: QueueEntry['status'][]) => queue.entries.filter((entry) => statuses.includes(entry.status)).length;
  const waiting = count(['queued', 'waiting-retry']);
  const running = count(['running']);
  const failed = queue.entries.filter((entry) => entry.status === 'failed');
  root.append(heading(`Queue: ${queueId}`), status(`${waiting} waiting, ${running} running, ${count(['done'])} done, ${failed.length} failed.`));
  const resume = button('Resume', true);
  resume.addEventListener('click', () => {
    lookup.automation.resumeQueue(queueId);
    sync();
  });
  if (queue.paused) {
    root.append(paragraph(PAUSE_REASONS[queue.pauseReason ?? 'paused'] ?? `Paused (${queue.pauseReason}).`), actions(resume));
  } else if (queue.awaitingResume) {
    root.append(paragraph('Work from before this file was opened waits until you resume it.'), actions(resume));
  } else if (waiting + running > 0) {
    const pause = button('Pause');
    pause.addEventListener('click', () => {
      lookup.automation.pauseQueue(queueId);
      sync();
    });
    root.append(actions(pause));
  }
  if (!failed.length) return;
  const list = document.createElement('ul');
  list.className = 'hvy-web-automation-failures';
  for (const entry of failed) {
    const item = document.createElement('li');
    item.className = 'hvy-web-automation-failure';
    const retry = button('Retry');
    retry.addEventListener('click', () => {
      lookup.automation.retryQueueEntry(queueId, entry.key);
      sync();
    });
    const cancel = button('Cancel');
    cancel.addEventListener('click', () => {
      lookup.automation.cancelQueueEntry(queueId, entry.key);
      sync();
    });
    item.append(paragraph(entry.key, 'hvy-web-automation-entry'), paragraph(entry.lastError ?? 'Failed.', 'hvy-web-error'), actions(retry, cancel));
    list.append(item);
  }
  root.append(list);
});

export const [webApiPlugin, webCollectionPlugin, queuePlugin] = createWebAutomationPlugins({
  webApi: webApiReader,
  collection: collectionReader,
  queue: queueReader,
});
