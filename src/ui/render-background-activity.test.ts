import { describe, expect, it } from 'vitest';
import { state } from '../state';
import type { BackgroundActivity } from '../webAutomation/app';
import { backgroundActivityLabel, renderBackgroundActivityDialog, renderBackgroundActivityIndicator } from './render-background-activity';

const idle: BackgroundActivity = { workers: [], waitingJobs: [], duplicates: [], documents: [], events: [] };

const queue = { queueId: 'evaluate', queued: 0, running: 0, retrying: 0, failed: 0, paused: false, pauseReason: null, awaitingResume: false };

describe('Background activity', () => {
  it('is hidden while nothing runs or waits, shows a word or two, and says in full what runs and what waits behind it', () => {
    expect(backgroundActivityLabel(null)).toBeNull();
    expect(backgroundActivityLabel({ ...idle, workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: null }] })).toBeNull();
    expect(backgroundActivityLabel({
      ...idle,
      workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files' }],
      waitingJobs: [{ profile: 'Personal', kind: 'api', label: 'Heavy Resume: Session' }, { profile: 'Personal', kind: 'api', label: 'Heavy Resume: Report' }],
    })).toEqual({ short: 'Working', full: 'Background: Heavy Resume: Files (2 waiting)' });
    expect(backgroundActivityLabel({
      ...idle,
      documents: [{ path: '/w/Search.hvy', runs: [], queues: [{ ...queue, queued: 3, paused: true, pauseReason: 'not_authenticated' }] }],
    })).toEqual({ short: '3 queued', full: 'Background: 3 queued (1 queue paused)' });
  });

  it('lists workers, flags the same call made twice, and offers each queue and run its control', () => {
    state.documentTabs = [];
    state.backgroundActivityOpen = true;
    state.backgroundActivity = {
      workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files' }],
      waitingJobs: [{ profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files' }],
      duplicates: ['Heavy Resume: Files'],
      documents: [{
        path: '/w/Search.hvy',
        runs: [{ runId: 'run-1', name: 'Careers pages', status: 'running', collected: 3, skipped: 1, problems: 0 }],
        queues: [{ ...queue, queued: 2, running: 1 }],
      }],
      events: [{ at: 0, source: 'api', message: 'call Files' }],
    };
    const html = renderBackgroundActivityDialog(state);
    expect(html.match(/same call twice/g)).toHaveLength(2);
    expect(html).toContain('Careers pages: collecting, 3 new, 1 already listed');
    expect(html).toContain('data-action="stop-background-run" data-path="/w/Search.hvy" data-run-id="run-1"');
    expect(html).toContain('evaluate: 1 running, 2 queued');
    expect(html).toContain('data-action="pause-background-queue"');
    expect(html).toContain('data-action="pause-all-background-queues"');
    expect(html).toContain('call Files');
    state.backgroundActivityOpen = false;
    expect(renderBackgroundActivityDialog(state)).toBe('');
    state.backgroundActivityLabel = { short: 'Working', full: 'Background: Heavy Resume: Files (1 waiting)' };
    const indicator = renderBackgroundActivityIndicator(state);
    expect(indicator).toContain('data-action="open-background-activity"');
    expect(indicator).toContain('title="Background: Heavy Resume: Files (1 waiting)"');
    expect(indicator).toContain('</span>Working</button>');
    state.backgroundActivityLabel = null;
    expect(renderBackgroundActivityIndicator(state)).toBe('');
  });
});
