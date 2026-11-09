import { describe, expect, it } from 'vitest';
import { state } from '../state';
import type { BackgroundActivity } from '../webAutomation/app';
import { backgroundActivityLabel, renderBackgroundActivityDialog, renderBackgroundActivityIndicator } from './render-background-activity';

const idle: BackgroundActivity = { workers: [], waitingJobs: [], duplicates: [], documents: [], events: [] };

const queue = { queueId: 'evaluate', queued: 0, running: 0, retrying: 0, failed: 0, failures: [], paused: false, pauseReason: null, awaitingResume: false };

describe('Background activity', () => {
  it('is hidden while nothing runs or waits, shows a word or two, and says in full what runs and what waits behind it', () => {
    expect(backgroundActivityLabel(null)).toBeNull();
    expect(backgroundActivityLabel({ ...idle, workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: null, needsYou: false }] })).toBeNull();
    expect(backgroundActivityLabel({
      ...idle,
      workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files', needsYou: false }],
      waitingJobs: [{ profile: 'Personal', kind: 'api', label: 'Heavy Resume: Session' }, { profile: 'Personal', kind: 'api', label: 'Heavy Resume: Report' }],
    })).toEqual({ short: 'Working', full: 'Background: Heavy Resume: Files (2 waiting)' });
    expect(backgroundActivityLabel({
      ...idle,
      documents: [{ path: '/w/Search.hvy', runs: [], queues: [{ ...queue, queued: 3, paused: true, pauseReason: 'not_authenticated' }] }],
    })).toEqual({ short: '3 queued', full: 'Background: 3 queued (1 queue paused)' });
  });

  it('says a run held on a page that needs you needs you, and Working while other work goes on', () => {
    const collecting = { workerId: 'w1', profile: 'Personal', kind: 'collection' as const, label: 'Careers pages: jobs.html', needsYou: true };
    const run = { runId: 'run-1', name: 'Careers pages', status: 'needs-attention' as const, collected: 30, skipped: 0, problems: 0 };
    const waiting: BackgroundActivity = { ...idle, workers: [collecting], documents: [{ path: '/w/Search.hvy', runs: [run], queues: [] }] };
    expect(backgroundActivityLabel(waiting)).toEqual({ short: 'Needs you', full: 'Background: Careers pages: needs you' });
    expect(backgroundActivityLabel({ ...waiting, workers: [collecting, { ...collecting, workerId: 'w2', label: 'Heavy Resume: Files', needsYou: false }] }))
      .toEqual({ short: 'Working', full: 'Background: Heavy Resume: Files (1 run needing you)' });
  });

  it('lists workers, flags the same call made twice, and offers each queue and run its control', () => {
    state.documentTabs = [];
    state.backgroundActivityOpen = true;
    state.backgroundActivity = {
      workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files', needsYou: false }],
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

  it('says why each queued call failed, and offers no Pause for a queue left with only failures', () => {
    state.documentTabs = [];
    state.backgroundActivityOpen = true;
    state.backgroundActivity = {
      ...idle,
      documents: [{ path: '/w/Search.hvy', runs: [], queues: [{ ...queue, failed: 1, failures: [{ key: 'https://jobs.example/1', error: 'The job description is empty.' }] }] }],
    };
    const html = renderBackgroundActivityDialog(state);
    expect(html).toContain('evaluate: 1 failed');
    expect(html).toContain('https://jobs.example/1</span> The job description is empty.');
    expect(html).not.toContain('pause-background-queue');
    expect(html).not.toContain('pause-all-background-queues');
    state.backgroundActivityOpen = false;
  });
});
