import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { encryptDocumentBytes } from '../../../../heavy-file-format/src/encryption';
import type { WebApiCapability } from '../webApi';
import type { FauxSite } from './fauxHost';
import type { FauxApiIntegration } from './integration';

export const ANALYSIS_ORIGIN = 'https://app.faux-analysis.test';
export const SECOND_ACCOUNT_SESSION = 'faux-session-2';
/** Where the service stores documents; open-source hands out signed read URLs here. */
export const STORAGE_ORIGIN = 'https://storage.faux-storage.test';
const STORED_SOURCE_PATH = '/bucket/source-1';
/** A sentence from the source document, for asserting that its text reached the service. */
export const SOURCE_DOCUMENT_PHRASE = 'Builds systems in TypeScript and Rust.';

/** A small neutral source document in HVY format. */
export const SOURCE_DOCUMENT_HVY = `---
hvy_version: 0.1
title: Profile
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:text {}-->
Pat Example

<!--hvy:text {}-->
${SOURCE_DOCUMENT_PHRASE}
`;

let storedSourceBytes: Promise<{ bytes: Uint8Array; keyId: string; key: string }> | null = null;

/** The source document as the service stores it: an encrypted HVY envelope. */
function storedSource() {
  storedSourceBytes ??= encryptDocumentBytes(new TextEncoder().encode(SOURCE_DOCUMENT_HVY));
  return storedSourceBytes;
}

export interface FauxAnalysisServiceState {
  /** The next N analysis creations answer 429. */
  rateLimitNextCreates: number;
  createCalls: number;
  lastSourceText: string | null;
  lastSourceRevision: string | null;
  /** Times the served source document was opened. */
  sourceOpens: number;
  /** Makes the open response point somewhere else (a misconfigured or compromised service). */
  servedUrlOverride: string | null;
  /** Storage returns bytes that do not match the announced hash. */
  corruptStoredSource: boolean;
  analysesByKey: Map<string, string>;
  analyses: Map<string, { id: string; url: string; text: string; polls: number }>;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

export const analysisServiceCapability: WebApiCapability = {
  capabilityId: 'analysis',
  name: 'Faux Analysis',
  pageUrl: `${ANALYSIS_ORIGIN}/`,
  allowedOrigins: [ANALYSIS_ORIGIN],
  storageOrigins: [STORAGE_ORIGIN],
  session: {
    loginUrl: `${ANALYSIS_ORIGIN}/login`,
    completeUrl: `${ANALYSIS_ORIGIN}/login/done`,
    probe: { endpointId: 'session', accountNamePointer: '/account/name', accountIdPointer: '/account/id' },
    logoutEndpointId: 'logout',
  },
  endpoints: [
    { id: 'session', name: 'Session', description: 'Current account.', method: 'GET', path: '/api/session', inputSchema: objectSchema({}) },
    { id: 'logout', name: 'Sign out', description: 'Ends the session.', method: 'POST', path: '/api/logout', inputSchema: objectSchema({}) },
    { id: 'profile', name: 'Profile', description: 'Account defaults.', method: 'GET', path: '/api/profile', inputSchema: objectSchema({}) },
    {
      id: 'create-analysis',
      name: 'Create analysis',
      description: 'Analyzes a text against a source document.',
      method: 'POST',
      path: '/api/analyses',
      inputSchema: objectSchema({
        // The text of the stored document sourceId names, opened through open-source when the call runs;
        // its revision fills sourceRevision.
        sourceText: {
          type: 'string',
          'x-hvy-source': 'document-text',
          'x-hvy-document-endpoint': 'open-source',
          'x-hvy-document-id': 'sourceId',
          'x-hvy-document-revision': 'sourceRevision',
        },
        sourceId: { type: 'string' },
        sourceRevision: { type: 'string' },
        url: { type: 'string' },
        text: { type: 'string' },
      }, ['sourceText', 'url', 'text']),
      idempotency: { header: 'Idempotency-Key', fromInputs: ['url'] },
      errorMessagePointer: '/error',
      timeoutMs: 30_000,
    },
    {
      id: 'open-source',
      name: 'Open source document',
      description: 'A signed read URL, checks, and keys for a stored source document.',
      method: 'GET',
      path: '/api/sources/{id}/open',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      servesDocument: {
        urlPointer: '/readUrl',
        extensionPointer: '/extension',
        byteLengthPointer: '/byteLength',
        sha256Pointer: '/sha256',
        keyringPointer: '/encryption/keyring',
        revision: [{ pointer: '/sha256' }, { pointer: '/generation', prefix: 'generation:' }],
      },
    },
    {
      id: 'get-analysis',
      name: 'Get analysis',
      description: 'Analysis status and result.',
      method: 'GET',
      path: '/api/analyses/{id}',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    },
  ],
};

/** A neutral signed-in service: web login, session probe, and idempotent analyses that finish asynchronously. */
export function fauxAnalysisService(): FauxApiIntegration<FauxAnalysisServiceState> {
  // Encrypting the stored copy is real asynchronous work; start it now so a request never waits on it in virtual time.
  void storedSource();
  const state: FauxAnalysisServiceState = {
    rateLimitNextCreates: 0, createCalls: 0, lastSourceText: null, lastSourceRevision: null, sourceOpens: 0, servedUrlOverride: null, corruptStoredSource: false, analysesByKey: new Map(), analyses: new Map(),
  };
  const accounts: Record<string, { id: string; name: string }> = {
    'faux-session': { id: 'a-1', name: 'Pat Example' },
    [SECOND_ACCOUNT_SESSION]: { id: 'a-2', name: 'Sam Other' },
  };
  const signedIn = (cookies: Record<string, string>) => Boolean(accounts[cookies.session_id]);
  const unauthorized = { status: 401, body: { error: 'Unauthorized' } };
  const view = (id: string) => `${ANALYSIS_ORIGIN}/analyses/${id}`;
  const site: FauxSite = {
    origin: ANALYSIS_ORIGIN,
    pages: { '/': {}, '/login': {}, '/login/done': {} },
    login: { loginPath: '/login', completePath: '/login/done', cookie: { name: 'session_id', value: 'faux-session' } },
    api: {
      'GET /api/session': ({ cookies }) => (signedIn(cookies) ? { status: 200, body: { account: accounts[cookies.session_id] } } : unauthorized),
      'POST /api/logout': ({ clearCookie }) => {
        clearCookie('session_id');
        return { status: 200, body: { ok: true } };
      },
      'GET /api/profile': ({ cookies }) => (signedIn(cookies) ? { status: 200, body: { defaultSourceId: 'source-1' } } : unauthorized),
      'POST /api/analyses': ({ cookies, headers, body }) => {
        if (!signedIn(cookies)) return unauthorized;
        state.createCalls += 1;
        if (state.rateLimitNextCreates > 0) {
          state.rateLimitNextCreates -= 1;
          return { status: 429, body: { error: 'The service is busy.' } };
        }
        const request = body as { url: string; text: string; sourceText: string; sourceRevision?: string };
        if (!request.text || request.text.length < 10) return { status: 400, body: { error: 'The text is too short to analyze.' } };
        state.lastSourceText = request.sourceText;
        state.lastSourceRevision = request.sourceRevision ?? null;
        const key = headers['Idempotency-Key'];
        const existingId = key ? state.analysesByKey.get(key) : undefined;
        const id = existingId ?? `analysis-${state.analyses.size + 1}`;
        if (!existingId) {
          state.analyses.set(id, { id, url: request.url, text: request.text, polls: 0 });
          if (key) state.analysesByKey.set(key, id);
        }
        return { status: 200, body: { id, status: 'pending', result: null, viewUrl: view(id) } };
      },
      'GET /api/sources/{id}/open': async ({ cookies, params }) => {
        if (!signedIn(cookies)) return unauthorized;
        if (params.id !== 'source-1') return { status: 404, body: { error: 'Not found' } };
        state.sourceOpens += 1;
        const stored = await storedSource();
        return {
          status: 200,
          body: {
            readUrl: state.servedUrlOverride ?? `${STORAGE_ORIGIN}${STORED_SOURCE_PATH}?signature=faux`,
            extension: '.hvy',
            generation: 3,
            sha256: bytesToHex(sha256(stored.bytes)),
            byteLength: stored.bytes.byteLength,
            encryption: { keyring: { [stored.keyId]: stored.key } },
          },
        };
      },
      'GET /api/analyses/{id}': ({ cookies, params }) => {
        if (!signedIn(cookies)) return unauthorized;
        const analysis = state.analyses.get(params.id);
        if (!analysis) return { status: 404, body: { error: 'Not found' } };
        analysis.polls += 1;
        if (analysis.polls < 2) return { status: 200, body: { id: analysis.id, status: 'pending', result: null, viewUrl: view(analysis.id) } };
        const strong = analysis.text.includes('TypeScript');
        return {
          status: 200,
          body: { id: analysis.id, status: 'ready', result: { rating: strong ? 'strong' : 'partial', reason: strong ? 'Strong overlap.' : 'Partial overlap.' }, viewUrl: view(analysis.id) },
        };
      },
    },
  };
  return {
    site,
    state,
    capability: analysisServiceCapability,
    createEndpointId: 'create-analysis',
    statusEndpointId: 'get-analysis',
    secondAccountSession: SECOND_ACCOUNT_SESSION,
    createInput: (item) => ({
      sourceId: 'source-1',
      url: item.url,
      text: item.fields.description,
    }),
    readResult: (body) => {
      const response = body as { id: string; status: 'pending' | 'ready'; viewUrl: string; result: { rating: string; reason: string } | null };
      return {
        id: response.id,
        status: response.status,
        url: response.viewUrl,
        fields: response.result ? { rating: response.result.rating, reason: response.result.reason } : {},
      };
    },
    extraSites: [{
      origin: STORAGE_ORIGIN,
      pages: {},
      files: {
        [STORED_SOURCE_PATH]: {
          bytes: async () => {
            const { bytes } = await storedSource();
            if (!state.corruptStoredSource) return bytes;
            const tampered = new Uint8Array(bytes);
            tampered[tampered.length - 2] ^= 1;
            return tampered;
          },
        },
      },
    }],
  };
}
