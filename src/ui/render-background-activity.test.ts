import { describe, expect, it } from 'vitest';
import { state } from '../state';
import type { BackgroundActivity } from '../webAutomation/app';
import { backgroundActivityLabel, renderBackgroundActivityDialog, renderBackgroundActivityIndicator } from './render-background-activity';

const idle: BackgroundActivity = { workers: [], waitingJobs: [], documents: [], events: [] };

const queue = { queueId: 'evaluate', queued: 0, running: 0, retrying: 0, failed: 0, failures: [], paused: false, pauseReason: null, pauseMessage: null, awaitingResume: false };

describe('Background activity', () => {
  it('is hidden while nothing runs or waits, shows a word or two, and says in full what runs and what waits behind it', () => {
    expect(backgroundActivityLabel(null)).toBeNull();
    expect(backgroundActivityLabel({ ...idle, workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: null, needsYou: false, duplicate: false }] })).toBeNull();
    expect(backgroundActivityLabel({
      ...idle,
      workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files', needsYou: false, duplicate: false }],
      waitingJobs: [{ profile: 'Personal', kind: 'api', label: 'Heavy Resume: Session', duplicate: false }, { profile: 'Personal', kind: 'api', label: 'Heavy Resume: Report', duplicate: false }],
    })).toEqual({ short: 'Working', full: 'Background: Heavy Resume: Files (2 waiting)' });
    expect(backgroundActivityLabel({
      ...idle,
      documents: [{ path: '/w/Search.hvy', runs: [], queues: [{ ...queue, queued: 3, paused: true, pauseReason: 'not_authenticated' }] }],
    })).toEqual({ short: '3 queued', full: 'Background: 3 queued (1 queue paused)' });
  });

  it('says a run held on a page that needs you needs you, and Working while other work goes on', () => {
    const collecting = { workerId: 'w1', profile: 'Personal', kind: 'collection' as const, label: 'Careers pages: jobs.html', needsYou: true, duplicate: false };
    const run = { runId: 'run-1', name: 'Careers pages', status: 'needs-attention' as const, collected: 30, skipped: 0, problems: 0 };
    const waiting: BackgroundActivity = { ...idle, workers: [collecting], documents: [{ path: '/w/Search.hvy', runs: [run], queues: [] }] };
    expect(backgroundActivityLabel(waiting)).toEqual({ short: 'Needs you', full: 'Background: Careers pages: needs you' });
    expect(backgroundActivityLabel({ ...waiting, workers: [collecting, { ...collecting, workerId: 'w2', label: 'Heavy Resume: Files', needsYou: false, duplicate: false }] }))
      .toEqual({ short: 'Working', full: 'Background: Heavy Resume: Files (1 run needing you)' });
  });

  it('lists workers, flags the same call made twice, and offers each queue and run its control', () => {
    state.documentTabs = [];
    state.backgroundActivityOpen = true;
    state.backgroundActivity = {
      workers: [{ workerId: 'w1', profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files', needsYou: false, duplicate: true }],
      waitingJobs: [{ profile: 'Personal', kind: 'api', label: 'Heavy Resume: Files', duplicate: true }],
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
    // What waits can be stopped, by queue or all at once (the runs too).
    expect(html).toContain('data-action="stop-background-queue" data-path="/w/Search.hvy" data-queue-id="evaluate"');
    expect(html).toContain('data-action="stop-all-background-work" >Stop all');
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
    // Pause all stays, so the Queues header keeps its height, with nothing to pause.
    expect(html).toContain('data-action="pause-all-background-queues" disabled');
    expect(html).not.toContain('stop-background-queue');
    expect(html).toContain('data-action="stop-all-background-work" disabled');
    state.backgroundActivityOpen = false;
  });

  it('says what the service said when its response paused a queue, which can be resumed or stopped', () => {
    state.documentTabs = [];
    state.backgroundActivityOpen = true;
    state.backgroundActivity = {
      ...idle,
      documents: [{ path: '/w/Search.hvy', runs: [], queues: [{ ...queue, queued: 4, paused: true, pauseReason: 'response', pauseMessage: 'Not enough premium HVY tokens for this request.' }] }],
    };
    const html = renderBackgroundActivityDialog(state);
    expect(html).toContain('evaluate: 4 queued · paused: Not enough premium HVY tokens for this request.');
    expect(html).toContain('data-action="resume-background-queue"');
    expect(html).toContain('data-action="stop-background-queue"');
    state.backgroundActivityOpen = false;
  });
});
