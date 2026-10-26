import { describe, expect, it } from 'vitest';
import { readCollectionBlockConfig, readQueueBlockConfig, readWebApiBlockConfig, WEB_AUTOMATION_SCHEMA_VERSION } from './configs';
import { analysisServiceCapability } from '../test/webAutomation/analysisService';
import { ATS_ORIGIN, atsDetailPattern, LISTING_FIELDS, listingCollection, talentSuiteDetailPattern, talentSuiteListingPattern } from '../test/webAutomation/sites';

const rawWebApi = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION,
  ...structuredClone(analysisServiceCapability),
  mcp: { endpointIds: ['profile'] },
  ...overrides,
});

const errorsOf = (result: { ok: boolean; errors?: string[] }) => (result.ok ? [] : result.errors ?? []);

describe('a place left out of collecting all', () => {
  it('keeps the flag through the configuration reader, and only when it is false', () => {
    const block = (startPages: unknown[]) => readCollectionBlockConfig({ schemaVersion: 1, capabilityId: 'jobs', fields: [{ id: 'title', label: 'Title' }], startPages });
    const read = block([{ id: 'a', url: 'https://jobs.test/a', included: false }, { id: 'b', url: 'https://jobs.test/b', included: true }]);
    expect(read.ok && read.value.collection.startPages).toEqual([{ id: 'a', url: 'https://jobs.test/a', included: false }, { id: 'b', url: 'https://jobs.test/b' }]);
  });
});

describe('block configuration readers', () => {
  it('round-trips the web API snapshot and its MCP exposure', () => {
    const result = readWebApiBlockConfig(rawWebApi());
    expect(result).toEqual({ ok: true, value: { capability: analysisServiceCapability, mcp: { endpointIds: ['profile'] } } });
  });

  it('rejects web API snapshots that could reach other origins or are incomplete', () => {
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ pageUrl: 'http://app.example.test/' })))).toEqual(['The page URL must use HTTPS.']);
    const endpoints = structuredClone(analysisServiceCapability.endpoints);
    endpoints[2] = { ...endpoints[2], path: '//evil.test/files' };
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ endpoints })))).toContain('Endpoint "profile" must use a same-origin path.');
    const session = { ...analysisServiceCapability.session, completeUrl: 'https://evil.test/done', probe: { endpointId: 'logout' } };
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ session })))).toEqual([
      'The completion URL must be on the page origin.',
      'The session probe must be a GET endpoint of this block.',
    ]);
    const undeclared = structuredClone(analysisServiceCapability.endpoints);
    const getAnalysis = undeclared.findIndex((endpoint) => endpoint.id === 'get-analysis');
    undeclared[getAnalysis] = { ...undeclared[getAnalysis], inputSchema: { type: 'object', properties: {} } };
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ endpoints: undeclared })))).toContain('Endpoint "get-analysis" uses {id} but does not declare it as an input.');
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ mcp: { endpointIds: ['nope'] } })))).toContain('MCP exposes an endpoint that is not defined.');
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ readOrigins: ['http://storage.example.test'] }))))
      .toContain('Read origin "http://storage.example.test" must use HTTPS (or HTTP on a loopback host).');
    const served = structuredClone(analysisServiceCapability.endpoints).map((endpoint) => (endpoint.id === 'open-source'
      ? { ...endpoint, inputSchema: { type: 'object', properties: { id: {}, extra: {} } }, servesDocument: { urlPointer: 'readUrl' } }
      : endpoint));
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ endpoints: served })))).toContain('Endpoint "open-source" serves a document but has no URL pointer.');
  });

  it('round-trips collections, including fingerprint scopes, and rejects unsafe scopes', () => {
    const collection = listingCollection([`${ATS_ORIGIN}/acme/jobs`], {
      patterns: [talentSuiteListingPattern, talentSuiteDetailPattern],
      key: { kind: 'fields', fields: ['company', 'title'] },
      ignoredQueryParameters: ['ref'],
      fields: LISTING_FIELDS.map((field) => (field.id === 'title' ? { ...field, required: true } : field)),
      startPages: [{ id: 'acme', url: `${ATS_ORIGIN}/acme/jobs`, values: { company: 'Acme' } }],
    });
    expect(readCollectionBlockConfig({ schemaVersion: 1, ...structuredClone(collection), mcp: { collect: true } }))
      .toEqual({ ok: true, value: { collection, mcp: { collect: true } } });

    const broad = { ...talentSuiteListingPattern, appliesTo: [{ target: 'page', host: '*.com' }] };
    const genericOnly = { ...talentSuiteDetailPattern, appliesTo: [{ target: 'fingerprint', signals: [{ kind: 'form-field', name: '__VIEWSTATE' }] }] };
    const noLink = { ...talentSuiteListingPattern, id: 'no-link', linkFieldId: undefined };
    expect(errorsOf(readCollectionBlockConfig({ schemaVersion: 1, ...collection, startPages: [{ id: 'ftp', url: 'ftp://x.test' }], patterns: [broad, genericOnly, noLink] }))).toEqual([
      '"ftp://x.test" is not an HTTPS start page.',
      'Pattern "talentsuite-listing": A wildcard host must name a registrable domain, such as "*.example.com".',
      'Pattern "talentsuite-detail": Add at least one signal specific to this platform.',
      'Listing pattern "no-link" needs a link field.',
    ]);
  });

  it('refuses references that do not resolve: fields, start page values, keys, the output, and pattern commands', () => {
    const acme = `${ATS_ORIGIN}/acme/jobs`;
    const unknownField = { ...atsDetailPattern, fields: [...atsDetailPattern.fields, { id: 'salary', kind: 'text' }] };
    const missingCommand = { ...atsDetailPattern, id: 'with-command', itemCommandId: 'open', matcher: { pattern: {}, commands: {} } };
    expect(errorsOf(readCollectionBlockConfig({
      schemaVersion: 1,
      ...listingCollection([acme]),
      fields: [...LISTING_FIELDS, { id: 'url', label: 'Link', kind: 'text' }, { id: 'title', label: 'Again', kind: 'text' }],
      startPages: [{ id: 'acme', url: acme, values: { team: 'Platform' } }, { id: 'acme', url: `${ATS_ORIGIN}/globex/jobs` }],
      patterns: [unknownField, missingCommand],
      key: { kind: 'field', field: 'requisition' },
      output: {
        store: { listPath: '/body/jobs/list', componentName: 'job', recordPath: 'item', fields: { salary: { kind: 'text', path: 'salary.txt' }, rating: { kind: 'text', path: 'rating.txt' } } },
        // The rating is written by other glue; records only write what they own.
        policy: { ownedFields: ['salary'] },
      },
    }))).toEqual([
      '"url" is not a field id: use lowercase letters, digits, "-" or "_", and not "url".',
      'Field id "title" is used twice.',
      `Start page "${acme}" fills "team", which is not one of the fields.`,
      'Start page id "acme" is used twice.',
      `Pattern "${atsDetailPattern.name}" fills "salary", which is not one of the fields.`,
      `Pattern "${atsDetailPattern.name}" runs command "open", which it does not have.`,
      'The record key uses "requisition", which is not one of the fields.',
      'Records may write "salary", which is not one of the fields.',
    ]);
  });

  it('reads queue blocks with bounded defaults and refuses queue-to-queue targets', () => {
    const result = readQueueBlockConfig({
      schemaVersion: 1,
      queueId: 'evaluate',
      target: { pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: 'analysis', endpointId: 'create-analysis' } },
      config: { concurrency: 99, retry: { maxAttempts: 0 } },
    });
    expect(result.ok && result.value.config).toMatchObject({ concurrency: 4, retry: { maxAttempts: 1 } });
    expect(errorsOf(readQueueBlockConfig({ schemaVersion: 1, queueId: 'q', target: { pluginId: 'galaxy.queue', method: 'enqueue' } })))
      .toEqual(['A queue cannot target another queue.']);
  });
});
