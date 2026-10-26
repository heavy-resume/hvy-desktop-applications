import type { PlatformSignal, SitePatternDefinition } from './sitePatterns';

/**
 * What the background automation needs from a browser host. The real
 * implementation lives in the Tauri and Electron hosts (worker webviews,
 * inspector injection, result routing by worker ID); the mock host
 * implements the same contract over simulated sites.
 */
export interface BrowserHost {
  createWorker(profileId: string): Promise<string>;
  /** Clears navigation history so one job cannot go "back" into another job's pages. */
  resetWorker(workerId: string): Promise<void>;
  closeWorker(workerId: string): Promise<void>;
  showWorker(workerId: string): Promise<void>;
  hideWorker(workerId: string): Promise<void>;

  navigate(workerId: string, url: string): Promise<PageLocation>;
  back(workerId: string): Promise<PageLocation>;
  inspect(workerId: string, request: InspectionRequest): Promise<PageInspection>;
  runCommand(workerId: string, request: CommandRequest): Promise<CommandResult>;
  /** Same-origin, credentialed request made from inside the page the worker is on. */
  request(workerId: string, request: HostRequest): Promise<HostResponse>;

  /**
   * Reads a file (a served document) from the host process into memory,
   * outside any page: a GET with no credentials or cookies, no redirects (a
   * redirect is an error), no referrer, and no cache. Nothing is saved. Fails
   * if more than `maxBytes` arrive. The caller checks the URL's origin first.
   */
  fetchFile(url: string, options: { maxBytes: number }): Promise<Uint8Array>;

  openUserWindow(profileId: string, url: string): Promise<void>;
  hideUserWindow(profileId: string): Promise<void>;
  onNavigation(listener: (event: NavigationEvent) => void): () => void;
}

export interface PageLocation {
  url: string;
}

export interface InspectionRequest {
  /** Patterns whose structural matchers should run on the page (results are keyed by pattern ID). */
  patterns: SitePatternDefinition[];
  /** Fingerprints to evaluate, keyed by pattern ID. */
  fingerprints: Record<string, PlatformSignal[]>;
}

export interface ExtractedRecord {
  /** Opaque, short-lived reference used to run item commands. */
  ref: string;
  values: Record<string, unknown>;
}

export interface PatternMatch {
  confidence: number;
  records: ExtractedRecord[];
}

export interface PageInspection {
  url: string;
  /** False when an interstitial blocks the expected page. */
  ready: boolean;
  attention?: 'challenge' | 'sign-in-wall';
  matches: Record<string, PatternMatch>;
  /** Number of matched signals per requested fingerprint; absent when it did not match. */
  fingerprintMatches: Record<string, number>;
  frames: Array<{ src: string }>;
}

export interface CommandRequest {
  /** The pattern the command belongs to; its matcher holds the command. */
  pattern: SitePatternDefinition;
  commandId: string;
  recordRef?: string;
}

export interface CommandResult {
  status: 'executed' | 'no_match' | 'ambiguous';
}

export interface HostRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HostResponse {
  status: number;
  contentType: string;
  body: unknown;
}

export interface NavigationEvent {
  profileId: string;
  window: 'user' | 'worker';
  workerId?: string;
  url: string;
}
