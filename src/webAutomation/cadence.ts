import type { CollectionDefinition, StartPage } from './collection';
import type { ScheduleTiming } from './configs';
import { nextTimeOfDay, timingText } from './scheduleSettings';

/**
 * How often a collection's start pages are checked: each page on a timing (its own, or the collection's), as a scheduled
 * job's is, every so long or at a time of day, from when a run last read it (`checkedAt`). "Fetch due" reads the pages due, the most overdue first, no more than the
 * collection's pages per run, so many pages added at once spread over the days after.
 */

const DAY_MS = 86_400_000;

/** When a page is checked: its own timing, or the collection's. */
export function checkTiming(collection: CollectionDefinition, page: StartPage): ScheduleTiming {
  return page.checkTiming ?? collection.checkTiming;
}

/** When a page is next due, in ms; null when it has never been checked (due now). */
export function dueAt(collection: CollectionDefinition, page: StartPage): number | null {
  const checked = page.checkedAt ? Date.parse(page.checkedAt) : Number.NaN;
  if (Number.isNaN(checked)) return null;
  // As a scheduled job's next turn: that long after its last check, or its next time of day after it.
  const timing = checkTiming(collection, page);
  return 'every' in timing ? checked + timing.every * 60_000 : nextTimeOfDay(checked, timing.at, timing.days);
}

/**
 * The start pages due now, among those `pages` (the ones a run may read), the most overdue first and those never
 * checked before them, no more than the collection's pages per run.
 */
export function duePages(collection: CollectionDefinition, pages: StartPage[], now: number): StartPage[] {
  return pages
    .map((page) => ({ page, due: dueAt(collection, page) ?? Number.NEGATIVE_INFINITY }))
    .filter(({ due }) => due <= now)
    .sort((left, right) => left.due - right.due)
    .slice(0, collection.duePagesPerRun)
    .map(({ page }) => page);
}

/** When a run last read a page: "Checked 3 days ago", or "Not checked yet". */
export function checkedText(page: StartPage, now: number): string {
  return page.checkedAt ? `Checked ${ago(now - Date.parse(page.checkedAt))}` : 'Not checked yet';
}

/**
 * When a page is due, and how often (set in Scheduling, its own or the defaults): "Due in 4 days · every 7 days", "Due
 * now · every day", "Due 3 days ago · every 7 days".
 */
export function scheduleText(collection: CollectionDefinition, page: StartPage, now: number): string {
  const often = timingText(checkTiming(collection, page));
  const due = dueAt(collection, page) ?? now;
  return `${due > now ? `Due in ${days(due - now)}` : now - due >= DAY_MS ? `Due ${days(now - due)} ago` : 'Due now'} · ${often}`;
}

function days(ms: number): string {
  const count = Math.max(1, Math.round(ms / DAY_MS));
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

function ago(ms: number): string {
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / 3_600_000);
    return hours < 1 ? 'just now' : `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return `${days(ms)} ago`;
}
