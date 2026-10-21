import { describe, expect, it } from 'vitest';
import { LISTING_FIELDS, listingCollection } from '../test/webAutomation/sites';
import type { CollectionDefinition, CollectionSite } from './collection';
import { readCollectionBlockConfig } from './configs';
import { fieldsNotRead, placesReadBy, planSiteSetupPaste, readSiteSetupText, recognizeAddress, siteSetupOf, siteSetupText, websitesOf, withSiteSetups, withoutSiteSetup } from './siteSetups';
import type { SitePatternDefinition } from './sitePatterns';

const ACME = 'https://boards.test/acme/jobs';
const GLOBEX = 'https://boards.test/globex/jobs';
const OWN = 'https://careers.initech.test/jobs/';

function pattern(siteId: string, id: string, fields: string[], scope: { host: string; path?: string }, role: 'listing' | 'detail' = 'listing'): SitePatternDefinition {
  return {
    id: `${siteId}:${id}`,
    name: id,
    role,
    appliesTo: [{ target: 'page', ...scope }],
    fields: [...fields.map((field) => ({ id: field, kind: 'text' as const })), ...(role === 'listing' ? [{ id: 'link', kind: 'link' as const }] : [])],
    ...(role === 'listing' ? { linkFieldId: 'link' } : {}),
    minimumConfidence: 0.8,
    siteId,
    version: 1,
  };
}

const boards: CollectionSite = { id: 'boards', name: 'Boards', from: { name: 'Publisher', version: 2 } };
const initech: CollectionSite = { id: 'initech', name: 'careers.initech.test/jobs/' };

/** Places on a hiring platform both read by one setup, and a company's own careers page set up by pointing at it. */
function collection(): CollectionDefinition {
  return {
    ...listingCollection([], { fields: LISTING_FIELDS }),
    startPages: [{ id: 'acme', url: ACME, values: { company: 'Acme' } }, { id: 'globex', url: GLOBEX }, { id: 'own', url: OWN }],
    sites: [boards, initech],
    patterns: [
      pattern('boards', 'list', ['title', 'location'], { host: 'boards.test' }),
      pattern('boards', 'job', ['title', 'description'], { host: 'boards.test', path: '/*/jobs/*' }, 'detail'),
      pattern('initech', 'list', ['title', 'company'], { host: 'careers.initech.test', path: '/jobs/*' }),
    ],
  };
}

const valid = (definition: CollectionDefinition) => readCollectionBlockConfig({ schemaVersion: 1, ...structuredClone(definition) });

describe('site setups', () => {
  it('reads every place on a site with one setup, with nothing tying a place to it', () => {
    const jobs = collection();
    expect(recognizeAddress(jobs, 'https://boards.test/hooli/jobs')?.site).toEqual(boards);
    expect(recognizeAddress(jobs, OWN)?.site).toEqual(initech);
    expect(recognizeAddress(jobs, 'https://elsewhere.test/jobs')).toBeNull();
    expect(placesReadBy(jobs, 'boards').map((page) => page.id)).toEqual(['acme', 'globex']);
    expect(valid(jobs).ok).toBe(true);
  });

  it('names the fields a setup does not read, for a place to fill', () => {
    const jobs = collection();
    expect(fieldsNotRead(jobs, siteSetupOf(jobs, 'boards')!.patterns).map((field) => field.id)).toEqual(['company']);
    expect(fieldsNotRead(jobs, siteSetupOf(jobs, 'initech')!.patterns).map((field) => field.id)).toEqual(['location', 'description']);
  });

  it('copies as text and pastes into another collection, updating a setup with the same id in place', () => {
    const source = collection();
    const updated = { ...siteSetupOf(source, 'boards')!, from: { name: 'Publisher', version: 3 } };
    updated.patterns = [pattern('boards', 'list-v3', ['title'], { host: 'boards.test' })];
    const text = siteSetupText([updated]);
    expect(text.split('\n')[0]).toBe('HVY site setup: Boards (Publisher v3)');

    const pasted = readSiteSetupText(`  ${text.replace(/\n/g, ' ')}  `)!;
    expect(pasted).toEqual([updated]);
    const target = collection();
    expect(planSiteSetupPaste(target, pasted)).toEqual([{ setup: updated, replaces: boards }]);
    const applied = { ...target, ...withSiteSetups(target, pasted) };
    expect(applied.sites).toEqual([{ ...boards, from: { name: 'Publisher', version: 3 } }, initech]);
    expect(applied.patterns.map((candidate) => candidate.id)).toEqual(['initech:list', 'boards:list-v3']);
    expect(websitesOf(updated)).toEqual(['boards.test']);
    expect(valid(applied).ok).toBe(true);
  });

  it('keeps a pasted pattern in its setup, and refuses a setup reading a field the collection lacks', () => {
    const text = siteSetupText([{ id: 'salaries', name: 'Salaries', patterns: [{ ...pattern('other', 'list', ['salary'], { host: 'pay.test' }) }] }]);
    const [setup] = readSiteSetupText(text)!;
    expect(setup.patterns[0].siteId).toBe('salaries');
    const target = collection();
    expect(valid({ ...target, ...withSiteSetups(target, [setup]) })).toMatchObject({ ok: false, errors: ['Pattern "list" fills "salary", which is not one of the fields.'] });
  });

  it('tells other text, and a cut-off setup, apart', () => {
    expect(readSiteSetupText('https://boards.test/acme/jobs')).toBeNull();
    expect(readSiteSetupText('{"hello": 1}')).toBeNull();
    expect(() => readSiteSetupText('HVY site setup: Boards\n{"hvy":"site-setup/1","sites":[{"id"')).toThrow('incomplete');
  });

  it('removes a setup with its patterns; its places stay, and are no longer read', () => {
    const jobs = collection();
    const removed = { ...jobs, ...withoutSiteSetup(jobs, 'boards') };
    expect(removed.patterns.map((candidate) => candidate.id)).toEqual(['initech:list']);
    expect(removed.startPages).toHaveLength(3);
    expect(recognizeAddress(removed, ACME)).toBeNull();
    // A pattern left for a setup that is gone is refused.
    expect(valid({ ...jobs, sites: [initech] })).toMatchObject({ ok: false, errors: ['Pattern "list" belongs to site setup "boards", which is not one of the site setups.', 'Pattern "job" belongs to site setup "boards", which is not one of the site setups.'] });
  });
});
