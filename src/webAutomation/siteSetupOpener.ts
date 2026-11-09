import type { CollectionDefinition, CollectionSite } from './collection';
import type { SitePatternDefinition } from './sitePatterns';

/**
 * Setting up a site by pointing at it, for a collection: the collection
 * reader asks the app to open its setup tool on an address. Nothing is saved
 * until **Done**, which hands the setup's patterns back to the reader; closing
 * the tool without it changes nothing.
 */
export interface SiteSetupRequest {
  collection: CollectionDefinition;
  /** The address it is set up on: the start page being added or fixed. */
  url: string;
  /** The setup being done again, or the new one's id and name. */
  site: CollectionSite;
  /** The address is one of its item pages, to add as another example (a page a run couldn't read), not its list. */
  itemExample?: boolean;
  /** Its patterns now (none for a new setup), to continue from. */
  patterns: SitePatternDefinition[];
  /** Why the block would refuse these patterns, without saving them. */
  check(patterns: SitePatternDefinition[]): string[];
  /** Done: the reader saves them (or goes on adding the start page). Returns why it was refused, if it was. */
  finish(patterns: SitePatternDefinition[]): string[];
}

let opener: ((request: SiteSetupRequest) => void) | null = null;

/** The app's setup tool. Until one is set, readers do not offer setting up a site. */
export function setSiteSetupOpener(next: ((request: SiteSetupRequest) => void) | null): void {
  opener = next;
}

export function canSetUpSites(): boolean {
  return opener !== null;
}

// UI: collection reader, "Set up this site" (adding a start page nothing reads, or fixing one).
export function setUpSite(request: SiteSetupRequest): void {
  opener?.(request);
}

/**
 * Showing how a site setup's item page pattern matches one of its item pages a run couldn't read: the page opens in the
 * app's browser with every close candidate boxed and scored, and each of its fields boxed pass or fail. Nothing is
 * picked; Add as example goes on to add the page to the setup, as the reader's own Add as example does.
 */
export interface SiteMatchingRequest {
  url: string;
  /** What one item is called ("job"). */
  itemName: string;
  /** The setup's item page pattern, as runs match it. */
  pattern: SitePatternDefinition;
  addExample(): void;
}

let matchingViewer: ((request: SiteMatchingRequest) => void) | null = null;

/** The app's browser, showing matching. Until one is set, readers do not offer it. */
export function setSiteMatchingViewer(next: ((request: SiteMatchingRequest) => void) | null): void {
  matchingViewer = next;
}

export function canShowSiteMatching(): boolean {
  return matchingViewer !== null;
}

// UI: collection reader, a problem page's "Show matching".
export function showSiteMatching(request: SiteMatchingRequest): void {
  matchingViewer?.(request);
}
