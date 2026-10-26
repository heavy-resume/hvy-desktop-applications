import type { CollectionDefinition, CollectionField, CollectionSite, StartPage } from './collection';
import { resolveSitePattern, type SitePatternDefinition } from './sitePatterns';

/**
 * Site setups in a collection: how to read a kind of page, as a named group
 * of patterns. A start page is read by whichever setup's
 * patterns match its address, so nothing ties the two together. Setups copy
 * as text, so they can be pasted into another collection, shared, or
 * published (a distributed document's publisher lists the sites it supports).
 */
export interface SiteSetup extends CollectionSite {
  patterns: SitePatternDefinition[];
}

/** What marks text as site setups. */
export const SITE_SETUP_FORMAT = 'site-setup/1';

export function patternsOf(collection: CollectionDefinition, siteId: string): SitePatternDefinition[] {
  return collection.patterns.filter((pattern) => pattern.siteId === siteId);
}

export function siteSetupOf(collection: CollectionDefinition, siteId: string): SiteSetup | null {
  const site = collection.sites.find((candidate) => candidate.id === siteId);
  return site ? { ...site, patterns: patternsOf(collection, site.id) } : null;
}

/** What reads an address: the best-matching list pattern (else an item page's), and its site setup when it has one. */
export function recognizeAddress(collection: CollectionDefinition, url: string): { site: CollectionSite | null; pattern: SitePatternDefinition } | null {
  for (const role of ['listing', 'detail'] as const) {
    const resolution = resolveSitePattern(collection.patterns, role, { url });
    // Several equally specific patterns are still recognized; the run reports which ones conflict.
    const pattern = resolution.kind === 'match' ? resolution.pattern : resolution.kind === 'ambiguous' ? resolution.candidates[0] : null;
    if (pattern) return { site: collection.sites.find((site) => site.id === pattern.siteId) ?? null, pattern };
  }
  return null;
}

/** The start pages a site setup reads now. */
export function startPagesReadBy(collection: CollectionDefinition, siteId: string): StartPage[] {
  return collection.startPages.filter((page) => recognizeAddress(collection, page.url)?.site?.id === siteId);
}

/** The fields no pattern of these reads: what a start page may need as fixed values, such as a company its pages don't name. */
export function fieldsNotRead(collection: CollectionDefinition, patterns: SitePatternDefinition[]): CollectionField[] {
  const read = new Set(patterns.flatMap((pattern) => pattern.fields.filter((field) => field.kind === 'text').map((field) => field.id)));
  return collection.fields.filter((field) => !read.has(field.id));
}

/** Where a setup reads, in words: its hosts, and "anywhere its platform appears" for a fingerprint. */
export function websitesOf(setup: SiteSetup): string[] {
  return [...new Set(setup.patterns.flatMap((pattern) => pattern.appliesTo.map((rule) => (rule.target === 'fingerprint' ? 'anywhere its platform appears' : rule.host))))];
}

/** A new setup's id from the address it is set up on, unique in the block. */
export function newSiteId(collection: CollectionDefinition, url: string): string {
  const parsed = new URL(url);
  const folder = parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/') + 1);
  const base = `${parsed.host}${folder}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
  const taken = new Set(collection.sites.map((site) => site.id));
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

function describe(setup: SiteSetup): string {
  return `${setup.name}${setup.from ? ` (${setup.from.name} v${setup.from.version})` : ''}`;
}

/** Site setups as text: a first line naming them, then the JSON. */
export function siteSetupText(setups: SiteSetup[]): string {
  const title = setups.length === 1 ? `HVY site setup: ${describe(setups[0])}` : `HVY site setups: ${setups.map(describe).join(', ')}`;
  return `${title}\n${JSON.stringify({ hvy: SITE_SETUP_FORMAT, sites: setups })}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The site setups in pasted text, or null when it is not site setup text.
 * Each pattern belongs to its setup, whatever the text says. Whether they fit
 * a collection is the integrity check's to say, when they are saved.
 */
export function readSiteSetupText(text: string): SiteSetup[] | null {
  const start = text.indexOf('{');
  if (start < 0 || !text.includes(`"${SITE_SETUP_FORMAT}"`)) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
  } catch {
    throw new Error('This site setup is incomplete. Copy all of it, and paste it again.');
  }
  if (!isRecord(value) || value.hvy !== SITE_SETUP_FORMAT) return null;
  if (!Array.isArray(value.sites) || !value.sites.length) throw new Error('This site setup has no sites in it.');
  return value.sites.map((site): SiteSetup => {
    if (!isRecord(site) || typeof site.id !== 'string' || !site.id.trim() || !Array.isArray(site.patterns)) throw new Error('This site setup is not one this version can read.');
    const id = site.id.trim();
    const from = isRecord(site.from) && typeof site.from.name === 'string' && typeof site.from.version === 'number' ? { name: site.from.name, version: site.from.version } : null;
    return {
      id,
      name: typeof site.name === 'string' && site.name.trim() ? site.name.trim() : id,
      ...(from ? { from } : {}),
      patterns: (site.patterns as SitePatternDefinition[]).map((pattern) => ({ ...pattern, siteId: id })),
    };
  });
}

/** A pasted site setup, and the one in the collection it updates. */
export interface SiteSetupPaste {
  setup: SiteSetup;
  replaces: CollectionSite | null;
}

export function planSiteSetupPaste(collection: CollectionDefinition, setups: SiteSetup[]): SiteSetupPaste[] {
  return setups.map((setup) => ({ setup, replaces: collection.sites.find((site) => site.id === setup.id) ?? null }));
}

/** The collection's setups with these added; one with an existing id replaces it in place, with its patterns. */
export function withSiteSetups(collection: CollectionDefinition, setups: SiteSetup[]): Pick<CollectionDefinition, 'sites' | 'patterns'> {
  const byId = new Map(setups.map((setup) => [setup.id, setup]));
  const site = ({ patterns: _patterns, ...rest }: SiteSetup): CollectionSite => rest;
  return {
    sites: [
      ...collection.sites.map((existing) => (byId.has(existing.id) ? site(byId.get(existing.id)!) : existing)),
      ...setups.filter((setup) => !collection.sites.some((existing) => existing.id === setup.id)).map(site),
    ],
    patterns: [
      ...collection.patterns.filter((pattern) => !pattern.siteId || !byId.has(pattern.siteId)),
      ...setups.flatMap((setup) => setup.patterns),
    ],
  };
}

/** A site setup and its patterns, removed; start pages stay. */
export function withoutSiteSetup(collection: CollectionDefinition, siteId: string): Pick<CollectionDefinition, 'sites' | 'patterns'> {
  return {
    sites: collection.sites.filter((site) => site.id !== siteId),
    patterns: collection.patterns.filter((pattern) => pattern.siteId !== siteId),
  };
}
