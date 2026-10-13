import { describe, expect, it } from 'vitest';
import { readCollectionBlockConfig, readQueueBlockConfig, readWebApiBlockConfig, WEB_AUTOMATION_SCHEMA_VERSION } from './configs';
import { analysisServiceCapability } from './faux/analysisService';
import { ATS_ORIGIN, listingCollection, talentSuiteDetailPattern, talentSuiteListingPattern } from './faux/sites';

const rawWebApi = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION,
  ...structuredClone(analysisServiceCapability),
  mcp: { endpointIds: ['profile'] },
  ...overrides,
});

const errorsOf = (result: { ok: boolean; errors?: string[] }) => (result.ok ? [] : result.errors ?? []);

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
    undeclared[4] = { ...undeclared[4], inputSchema: { type: 'object', properties: {} } };
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ endpoints: undeclared })))).toContain('Endpoint "get-analysis" uses {id} but does not declare it as an input.');
    expect(errorsOf(readWebApiBlockConfig(rawWebApi({ mcp: { endpointIds: ['nope'] } })))).toContain('MCP exposes an endpoint that is not defined.');
  });

  it('round-trips collections, including fingerprint scopes, and rejects unsafe scopes', () => {
    const collection = listingCollection([`${ATS_ORIGIN}/acme/jobs`], {
      patterns: [talentSuiteListingPattern, talentSuiteDetailPattern],
      key: { kind: 'fields', fields: ['company', 'title'] },
      ignoredQueryParameters: ['ref'],
      requiredFields: [{ field: 'title' }],
      jsonLd: { type: 'Event' },
    });
    expect(readCollectionBlockConfig({ schemaVersion: 1, ...structuredClone(collection), mcp: { collect: true } }))
      .toEqual({ ok: true, value: { collection, mcp: { collect: true } } });

    const broad = { ...talentSuiteListingPattern, appliesTo: [{ target: 'page', host: '*.com' }] };
    const genericOnly = { ...talentSuiteDetailPattern, appliesTo: [{ target: 'fingerprint', signals: [{ kind: 'form-field', name: '__VIEWSTATE' }] }] };
    const noLink = { ...talentSuiteListingPattern, id: 'no-link', linkFieldId: undefined };
    expect(errorsOf(readCollectionBlockConfig({ schemaVersion: 1, ...collection, startUrls: ['ftp://x.test'], patterns: [broad, genericOnly, noLink] }))).toEqual([
      '"ftp://x.test" is not an HTTPS start URL.',
      'Pattern "talentsuite-listing": A wildcard host must name a registrable domain, such as "*.example.com".',
      'Pattern "talentsuite-detail": Add at least one signal specific to this platform.',
      'Listing pattern "no-link" needs a link field.',
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
