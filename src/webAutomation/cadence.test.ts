import { describe, expect, it } from 'vitest';
import { cadenceText, duePages } from './cadence';
import { ATS_ORIGIN, listingCollection } from '../test/webAutomation/sites';
import type { StartPage } from './collection';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const page = (id: string, extra: Partial<StartPage> = {}): StartPage => ({ id, url: `${ATS_ORIGIN}/${id}/jobs`, ...extra });

describe('start page cadence', () => {
  it('takes the pages due, never checked first, then the most overdue, no more than a run takes', () => {
    const collection = { ...listingCollection([]), checkEveryDays: 7, duePagesPerRun: 3 };
    const pages = [
      page('fresh', { checkedAt: daysAgo(2) }),
      page('overdue', { checkedAt: daysAgo(10) }),
      page('due', { checkedAt: daysAgo(7) }),
      page('never'),
      page('very-overdue', { checkedAt: daysAgo(30) }),
    ];
    expect(duePages(collection, pages, NOW).map((due) => due.id)).toEqual(['never', 'very-overdue', 'overdue']);
  });

  it('checks a page that sets its own cadence by it', () => {
    const collection = { ...listingCollection([]), checkEveryDays: 7, duePagesPerRun: 10 };
    const pages = [page('daily', { checkedAt: daysAgo(2), checkEveryDays: 1 }), page('weekly', { checkedAt: daysAgo(2) })];
    expect(duePages(collection, pages, NOW).map((due) => due.id)).toEqual(['daily']);
  });

  it('says when a page was checked and when it is due', () => {
    const collection = { ...listingCollection([]), checkEveryDays: 7, duePagesPerRun: 10 };
    expect(cadenceText(collection, page('never'), NOW)).toBe('Not checked yet · due');
    expect(cadenceText(collection, page('fresh', { checkedAt: daysAgo(3) }), NOW)).toBe('Checked 3 days ago · due in 4 days');
    expect(cadenceText(collection, page('today', { checkedAt: new Date(NOW - 2 * 3_600_000).toISOString() }), NOW)).toBe('Checked 2 hours ago · due in 7 days');
    expect(cadenceText(collection, page('late', { checkedAt: daysAgo(10) }), NOW)).toBe('Checked 10 days ago · due 3 days ago');
  });
});
