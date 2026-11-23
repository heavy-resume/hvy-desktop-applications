import { registerHvyCliPluginCommands } from '../../../heavy-file-format/src/cli-core/plugin-command-registry';
import { createConditionallyAllowedPlugin } from '../../../heavy-file-format/src/plugins/authorization/conditional-plugin';
import type { HvyPlugin } from '../../../heavy-file-format/src/plugins/types';
import { showSystemNotification } from '../backend';
import { documentFileFor } from '../webAutomation/app';

/**
 * Notifications: a script tells the user something through the system's notifications, such as a scheduled job that
 * found something. doc.plugins.call("galaxy.notifications", "notify", {"title", "body", "target"}) shows one and says
 * whether it was shown. Clicked, it brings Galaxy forward with its document, at the section or component "target"
 * names (notificationClicks.ts). Allowed per file, as Schedule and the web plugins are: a file not allowed it yet gets the
 * registration, with no scripting methods.
 */
export const NOTIFICATIONS_PLUGIN_ID = 'galaxy.notifications';

/** Across the app, as the system counts them: at most this many in each span; the rest are dropped. */
export const NOTIFICATION_LIMITS = [
  { count: 3, ms: 5_000 },
  { count: 5, ms: 60_000 },
] as const;

/** When the notifications still counted against a limit were shown. */
let shownAt: number[] = [];

/** A notification's turn: taken, and true, when no limit is reached; false when it is to be dropped. */
export function takeNotificationTurn(now = Date.now()): boolean {
  const longest = Math.max(...NOTIFICATION_LIMITS.map((limit) => limit.ms));
  shownAt = shownAt.filter((at) => now - at < longest);
  if (NOTIFICATION_LIMITS.some((limit) => shownAt.filter((at) => now - at < limit.ms).length >= limit.count)) return false;
  shownAt.push(now);
  return true;
}

export function resetNotificationTurns(): void {
  shownAt = [];
}

const metadata = { id: NOTIFICATIONS_PLUGIN_ID, version: '0.1.0', hvyApiVersion: '0.1', displayName: 'Notifications' };

/** What a file allowed it gets. */
export const notificationsImplementation: HvyPlugin = {
  ...metadata,
  scripting: {
    methods: {
      notify: (args, ctx) => {
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        if (!title) throw new Error('notify needs a title.');
        if (args.body !== undefined && typeof args.body !== 'string') throw new Error('notify\'s body is text.');
        if (args.target !== undefined && typeof args.target !== 'string') throw new Error('notify\'s target is a section or component id.');
        if (!takeNotificationTurn()) return false;
        const file = documentFileFor(ctx.rawDocument);
        // The script has its answer already: a notification the system refuses is reported here, not to it.
        showSystemNotification({
          title,
          body: (args.body as string | undefined)?.trim() ?? '',
          click: {
            documentId: file?.documentId ?? '',
            path: file?.path ?? '',
            target: (args.target as string | undefined)?.trim() ?? '',
          },
        }).catch((error: unknown) => console.error('Notification not shown:', error));
        return true;
      },
    },
  },
  aiHint: 'Shows a system notification: notify({"title", "body", "target"}) returns whether it was shown (at most 3 in 5 seconds and 5 a minute across Galaxy). Clicked, it opens this document at "target", a section or component id.',
};

export const notificationsPlugin = createConditionallyAllowedPlugin({ ...metadata, load: async () => notificationsImplementation });

registerHvyCliPluginCommands({
  name: 'galaxy-notifications',
  pluginId: NOTIFICATIONS_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-notifications',
  componentHints: [
    'This plugin has no block: scripts call it to show a system notification, such as when a scheduled job finds something.',
    'doc.plugins.call("galaxy.notifications", "notify", {"title": ..., "body": ..., "target": ...}) returns True when shown and False when dropped: at most 3 are shown in 5 seconds and 5 a minute, across Galaxy. "title" is required; "body" is optional text; "target" is an optional section or component id that a click opens the document at.',
    'The document must declare it in its scripting plugins.',
  ],
  addCommands: [],
  operationCommands: [],
  lintChecks: [],
});
