import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ showSystemNotification: vi.fn(async () => undefined) }));
const file = vi.hoisted(() => ({ documentId: 'doc-1', path: '/workspace/jobs.hvy' }));

vi.mock('../backend', () => backend);
vi.mock('../webAutomation/app', () => ({ documentFileFor: () => file }));

import { notificationsImplementation, notificationsPlugin, resetNotificationTurns, takeNotificationTurn } from './notifications';

const notify = (args: Record<string, unknown>) => notificationsImplementation.scripting!.methods.notify(args as never, { rawDocument: {} } as never);

describe('notifications', () => {
  beforeEach(() => {
    resetNotificationTurns();
    backend.showSystemNotification.mockClear();
  });

  it('shows 3 in 5 seconds and 5 in a minute, dropping the rest', () => {
    const shown = (at: number) => takeNotificationTurn(at);
    expect([0, 1_000, 2_000, 3_000].map(shown)).toEqual([true, true, true, false]);
    expect([5_000, 6_000, 7_000].map(shown)).toEqual([true, true, false]);
    // The first of the minute's five has left it.
    expect(shown(60_000)).toBe(true);
  });

  it('sends its document and target, and says when it was dropped', () => {
    expect(notify({ title: ' Job search ', body: '3 new', target: 'new-postings' })).toBe(true);
    expect(backend.showSystemNotification).toHaveBeenCalledWith({
      title: 'Job search',
      body: '3 new',
      click: { documentId: 'doc-1', path: '/workspace/jobs.hvy', target: 'new-postings' },
    });
    notify({ title: 'Two' });
    notify({ title: 'Three' });
    expect(notify({ title: 'Four' })).toBe(false);
    expect(backend.showSystemNotification).toHaveBeenCalledTimes(3);
  });

  it('is allowed per file: the registration has no scripting until a file allows it', () => {
    expect(notificationsPlugin.authorization).toBe('required');
    expect(notificationsPlugin.scripting).toBeUndefined();
  });

  it('needs a title', () => {
    expect(() => notify({ body: 'no title' })).toThrow('notify needs a title.');
  });
});
