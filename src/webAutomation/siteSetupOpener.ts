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
  /** The address it is set up on: the place being added or fixed. */
  url: string;
  /** The setup being done again, or the new one's id and name. */
  site: CollectionSite;
  /** Its patterns now (none for a new setup), to continue from. */
  patterns: SitePatternDefinition[];
  /** Why the block would refuse these patterns, without saving them. */
  check(patterns: SitePatternDefinition[]): string[];
  /** Done: the reader saves them (or goes on adding the place). Returns why it was refused, if it was. */
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

// UI: collection reader, "Set up this site" (adding a place nothing reads, or fixing one).
export function setUpSite(request: SiteSetupRequest): void {
  opener?.(request);
}
