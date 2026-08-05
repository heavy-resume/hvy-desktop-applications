import { integrationBrowserCommand, probeIntegrationCookieStorage, type IntegrationBrowserCommand, type IntegrationStorageProbeResult } from './backend';

export type IntegrationBrowserDestination = 'msn' | 'gmail' | 'calendar';
export const DEFAULT_INTEGRATION_PROFILE_ID = 'default-google';

export interface IntegrationPageIdentity {
  origin: string;
  pathname: string;
}

export interface IntegrationPageExtractor<T> {
  id: string;
  matches(page: IntegrationPageIdentity): boolean;
  extract(document: Document): T;
}

export interface IntegrationExtractionResult<T = unknown> {
  profileId: string;
  extractorId: string;
  page: IntegrationPageIdentity;
  value: T;
}

export function openIntegrationBrowser(destination: IntegrationBrowserDestination, profileId = DEFAULT_INTEGRATION_PROFILE_ID, browserStoreId = 'default-google', actionMode = false, extraction?: unknown): Promise<void> {
  return integrationBrowserCommand('open', destination, profileId, undefined, undefined, browserStoreId, actionMode, extraction);
}

export function openIntegrationPage(url: string, allowedOrigins: string[], profileId = DEFAULT_INTEGRATION_PROFILE_ID, browserStoreId = 'default-google', actionMode = false, extraction?: unknown): Promise<void> {
  return integrationBrowserCommand('open', undefined, profileId, url, allowedOrigins, browserStoreId, actionMode, extraction);
}

export function controlIntegrationBrowser(command: Exclude<IntegrationBrowserCommand, 'open'>, profileId = DEFAULT_INTEGRATION_PROFILE_ID, payload?: unknown): Promise<void> {
  return integrationBrowserCommand(command, undefined, profileId, undefined, undefined, undefined, undefined, payload);
}

export function runIntegrationStorageProbe(): Promise<IntegrationStorageProbeResult> {
  return probeIntegrationCookieStorage();
}

// This deliberately has no registered site extractors yet. The result shape is the
// only cross-boundary contract future deterministic page adapters should emit.
export function isIntegrationExtractionResult(value: unknown): value is IntegrationExtractionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<IntegrationExtractionResult>;
  return typeof candidate.profileId === 'string'
    && candidate.profileId.length > 0
    && typeof candidate.extractorId === 'string'
    && candidate.extractorId.length > 0
    && Boolean(candidate.page)
    && typeof candidate.page?.origin === 'string'
    && typeof candidate.page?.pathname === 'string'
    && 'value' in candidate;
}
