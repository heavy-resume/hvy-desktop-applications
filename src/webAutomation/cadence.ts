import type { CollectionDefinition, StartPage } from './collection';

/**
 * How often a collection's start pages are checked: each page every so many days (its own, or the collection's), from
 * when a run last read it (`checkedAt`). "Fetch due" reads the pages due, the most overdue first, no more than the
 * collection's pages per run, so many pages added at once spread over the days after.
 */

const DAY_MS = 86_400_000;

/** How many days apart a page is checked: its own, or the collection's. */
export function checkEveryDays(collection: CollectionDefinition, page: StartPage): number {
  return page.checkEveryDays ?? collection.checkEveryDays;
}

/** When a page is next due, in ms; null when it has never been checked (due now). */
export function dueAt(collection: CollectionDefinition, page: StartPage): number | null {
  const checked = page.checkedAt ? Date.parse(page.checkedAt) : Number.NaN;
  return Number.isNaN(checked) ? null : checked + checkEveryDays(collection, page) * DAY_MS;
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

/** When a page was checked and is due, in words: "Checked 3 days ago · due in 4 days". */
export function cadenceText(collection: CollectionDefinition, page: StartPage, now: number): string {
  const due = dueAt(collection, page);
  if (due === null) return 'Not checked yet · due';
  const checked = `Checked ${ago(now - Date.parse(page.checkedAt!))}`;
  return `${checked} · ${due <= now ? `due${now - due >= DAY_MS ? ` ${days(now - due)} ago` : ''}` : `due in ${days(due - now)}`}`;
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
