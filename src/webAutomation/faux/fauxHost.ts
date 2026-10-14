import { stableJson } from '../../webCapabilities';
import type {
  BrowserHost,
  CommandRequest,
  CommandResult,
  HostRequest,
  HostResponse,
  InspectionRequest,
  NavigationEvent,
  PageInspection,
  PageLocation,
  PatternMatch,
} from '../host';
import { globMatches, type PlatformSignal } from '../sitePatterns';
import { WebAutomationError } from '../errors';

export interface FauxPage {
  /** Pattern ID → what that pattern extracts here. Stands in for structural matching. */
  matches?: Record<string, PatternMatch>;
  jsonLd?: unknown[];
  signals?: PlatformSignal[];
  /** Where the pagination command leads, as a path or URL. */
  nextPage?: string;
  /** False for single-page-app listings that do not restore after back navigation. */
  restoresOnBack?: boolean;
  /** Blocks the page until the profile holds the site's clearance cookie. */
  challenge?: boolean;
  frames?: Array<{ src: string }>;
  /** Side-pane boards: record ref → what the pane shows after the item command. */
  panes?: Record<string, Pick<FauxPage, 'matches' | 'jsonLd'>>;
}

export interface FauxRouteRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  cookies: Record<string, string>;
  clearCookie(name: string): void;
}

export type FauxRoute = (request: FauxRouteRequest) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

export interface FauxSite {
  origin: string;
  /** Keyed by path, optionally with query: "/acme/jobs?page=2". */
  pages: Record<string, FauxPage>;
  /** Keyed by "METHOD /path/{param}". */
  api?: Record<string, FauxRoute>;
  login?: { loginPath: string; completePath: string; cookie: { name: string; value: string } };
  /** Files served for download (for example, a storage bucket), keyed by path; the query (a signature) is ignored. */
  files?: Record<string, { bytes(): Uint8Array | Promise<Uint8Array>; redirectTo?: string }>;
}

const CLEARANCE_COOKIE = 'faux_clearance';

interface FauxWorker {
  profileId: string;
  history: string[];
  index: number;
  restored: boolean;
  visible: boolean;
  pane: string | null;
}

export class FauxHost implements BrowserHost {
  private heldRequests: Array<{ path: string; released: Promise<void> }> = [];
  private readonly sites = new Map<string, FauxSite>();
  private readonly jars = new Map<string, Map<string, Record<string, string>>>();
  private readonly workers = new Map<string, FauxWorker>();
  private readonly userWindows = new Map<string, { url: string; visible: boolean }>();
  private readonly listeners = new Set<(event: NavigationEvent) => void>();
  private nextWorker = 1;
  log: (message: string) => void = () => undefined;

  constructor(sites: FauxSite[]) {
    for (const site of sites) this.sites.set(site.origin, site);
  }

  // ── BrowserHost ──────────────────────────────────────────────

  async createWorker(profileId: string): Promise<string> {
    const workerId = `w${this.nextWorker++}`;
    this.workers.set(workerId, { profileId, history: [], index: -1, restored: true, visible: false, pane: null });
    return workerId;
  }

  async resetWorker(workerId: string): Promise<void> {
    const worker = this.worker(workerId);
    const current = worker.history[worker.index];
    worker.history = current ? [current] : [];
    worker.index = worker.history.length - 1;
    worker.restored = true;
  }

  async closeWorker(workerId: string): Promise<void> {
    this.workers.delete(workerId);
  }

  async showWorker(workerId: string): Promise<void> {
    this.worker(workerId).visible = true;
    this.log(`${workerId} shown to the user`);
  }

  async hideWorker(workerId: string): Promise<void> {
    this.worker(workerId).visible = false;
  }

  async navigate(workerId: string, url: string): Promise<PageLocation> {
    const worker = this.worker(workerId);
    const href = new URL(url).href;
    worker.history = [...worker.history.slice(0, worker.index + 1), href];
    worker.index = worker.history.length - 1;
    worker.restored = true;
    worker.pane = null;
    this.log(`${workerId} → ${this.short(href)}`);
    this.notify({ profileId: worker.profileId, window: 'worker', workerId, url: href });
    return { url: href };
  }

  async back(workerId: string): Promise<PageLocation> {
    const worker = this.worker(workerId);
    if (worker.index <= 0) throw new Error(`${workerId} has no page to go back to.`);
    worker.index -= 1;
    worker.pane = null;
    const href = worker.history[worker.index];
    worker.restored = this.page(href)?.restoresOnBack !== false;
    this.log(`${workerId} ← back to ${this.short(href)}${worker.restored ? '' : ' (not restored)'}`);
    return { url: href };
  }

  async inspect(workerId: string, request: InspectionRequest): Promise<PageInspection> {
    const worker = this.worker(workerId);
    const url = worker.history[worker.index];
    const page = this.page(url);
    if (page?.challenge && !this.cookies(worker.profileId, new URL(url).origin)[CLEARANCE_COOKIE]) {
      return { url, ready: false, attention: 'challenge', matches: {}, fingerprintMatches: {}, jsonLd: [], frames: [] };
    }
    const pane = worker.pane ? page?.panes?.[worker.pane] : undefined;
    const visible = { ...(page?.matches ?? {}), ...(pane?.matches ?? {}) };
    const matches = worker.restored
      ? Object.fromEntries(Object.entries(visible).filter(([patternId]) => request.patternIds.includes(patternId)))
      : {};
    const fingerprintMatches = Object.fromEntries(Object.entries(request.fingerprints).flatMap(([patternId, signals]) => (
      signals.length && signals.every((signal) => this.signalPresent(url, page, signal)) ? [[patternId, signals.length]] : []
    )));
    return {
      url,
      ready: true,
      matches: structuredClone(matches),
      fingerprintMatches,
      jsonLd: structuredClone(pane?.jsonLd ?? page?.jsonLd ?? []),
      frames: structuredClone(page?.frames ?? []),
    };
  }

  async runCommand(workerId: string, request: CommandRequest): Promise<CommandResult> {
    const worker = this.worker(workerId);
    const url = worker.history[worker.index];
    if (request.recordRef) {
      if (!this.page(url)?.panes?.[request.recordRef]) return { status: 'no_match' };
      worker.pane = request.recordRef;
      this.log(`${workerId} click ${request.commandId} on ${request.recordRef}`);
      return { status: 'executed' };
    }
    const next = this.page(url)?.nextPage;
    if (!next) return { status: 'no_match' };
    this.log(`${workerId} click ${request.commandId}`);
    await this.navigate(workerId, new URL(next, url).href);
    return { status: 'executed' };
  }

  async request(workerId: string, request: HostRequest): Promise<HostResponse> {
    const worker = this.worker(workerId);
    const current = worker.history[worker.index];
    const target = new URL(request.url);
    if (!current || new URL(current).origin !== target.origin) {
      throw new Error(`Cross-origin request from ${current ?? 'a blank page'} to ${target.origin}.`);
    }
    const held = this.heldRequests.find((hold) => target.pathname.startsWith(hold.path));
    if (held) await held.released;
    const site = this.sites.get(target.origin);
    const route = this.findRoute(site, request.method, target.pathname);
    const jar = this.cookies(worker.profileId, target.origin);
    if (!route) return { status: 404, contentType: 'application/json', body: { error: 'Not found' } };
    const response = await route.handler({
      method: request.method,
      path: target.pathname,
      params: route.params,
      headers: request.headers,
      body: request.body ? JSON.parse(request.body) : null,
      cookies: { ...jar },
      clearCookie: (name) => {
        delete jar[name];
      },
    });
    return { status: response.status, contentType: 'application/json', body: structuredClone(response.body) };
  }

  async openUserWindow(profileId: string, url: string): Promise<void> {
    this.userWindows.set(profileId, { url, visible: true });
    this.log(`user window (${profileId}) → ${this.short(url)}`);
    this.notify({ profileId, window: 'user', url });
  }

  async hideUserWindow(profileId: string): Promise<void> {
    const window = this.userWindows.get(profileId);
    if (window) window.visible = false;
    this.log(`user window (${profileId}) hidden`);
  }

  onNavigation(listener: (event: NavigationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Simulated user actions ───────────────────────────────────

  /** The user finishes the site's own login form in the user window, optionally as a different account. */
  completeLogin(profileId: string, origin: string, cookieValue?: string): void {
    const site = this.sites.get(origin);
    if (!site?.login) throw new Error(`${origin} has no faux login.`);
    this.cookies(profileId, origin)[site.login.cookie.name] = cookieValue ?? site.login.cookie.value;
    const url = new URL(site.login.completePath, origin).href;
    this.userWindows.set(profileId, { url, visible: true });
    this.log(`user window (${profileId}) → ${this.short(url)}`);
    this.notify({ profileId, window: 'user', url });
  }

  async download(url: string, options: { maxBytes: number }): Promise<Uint8Array> {
    const target = new URL(url);
    const file = this.sites.get(target.origin)?.files?.[target.pathname];
    this.log(`download ${this.short(url)} (no credentials)`);
    if (!file) throw new WebAutomationError('http_error', `${target.origin}${target.pathname} returned 404.`, 404);
    if (file.redirectTo) throw new WebAutomationError('http_error', `${target.origin}${target.pathname} redirected; redirects are not followed.`, 302);
    const bytes = await file.bytes();
    if (bytes.byteLength > options.maxBytes) throw new WebAutomationError('invalid_request', `The download is larger than ${options.maxBytes} bytes.`);
    return new Uint8Array(bytes);
  }

  /** Holds requests to paths under `path` until released, like a slow network: the call stays in flight. */
  holdRequests(path: string): () => void {
    let release = () => undefined as void;
    const hold = { path, released: new Promise<void>((resolve) => { release = resolve; }) };
    this.heldRequests.push(hold);
    this.log(`requests to ${path} held`);
    return () => {
      this.heldRequests = this.heldRequests.filter((candidate) => candidate !== hold);
      this.log(`requests to ${path} released`);
      release();
    };
  }

  /** The user solves a bot challenge; the clearance is shared by the profile's webviews. */
  solveChallenge(profileId: string, origin: string): void {
    this.cookies(profileId, origin)[CLEARANCE_COOKIE] = 'ok';
    this.log(`challenge solved for ${new URL(origin).host} (${profileId})`);
  }

  /** The site's session expires or is revoked elsewhere. */
  expireSession(profileId: string, origin: string): void {
    const site = this.sites.get(origin);
    if (site?.login) delete this.cookies(profileId, origin)[site.login.cookie.name];
    this.log(`session expired for ${new URL(origin).host} (${profileId})`);
  }

  isUserWindowVisible(profileId: string): boolean {
    return this.userWindows.get(profileId)?.visible ?? false;
  }

  isWorkerVisible(workerId: string): boolean {
    return this.workers.get(workerId)?.visible ?? false;
  }

  workerIds(): string[] {
    return [...this.workers.keys()];
  }

  // ── Internals ────────────────────────────────────────────────

  private worker(workerId: string): FauxWorker {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Unknown worker ${workerId}.`);
    return worker;
  }

  private page(url: string | undefined): FauxPage | undefined {
    if (!url) return undefined;
    const parsed = new URL(url);
    const site = this.sites.get(parsed.origin);
    return site?.pages[`${parsed.pathname}${parsed.search}`] ?? site?.pages[parsed.pathname];
  }

  private cookies(profileId: string, origin: string): Record<string, string> {
    let jar = this.jars.get(profileId);
    if (!jar) {
      jar = new Map();
      this.jars.set(profileId, jar);
    }
    let cookies = jar.get(origin);
    if (!cookies) {
      cookies = {};
      jar.set(origin, cookies);
    }
    return cookies;
  }

  private signalPresent(url: string, page: FauxPage | undefined, signal: PlatformSignal): boolean {
    if (signal.kind === 'path') return globMatches(signal.glob, new URL(url).pathname);
    return (page?.signals ?? []).some((candidate) => stableJson(candidate) === stableJson(signal));
  }

  private findRoute(site: FauxSite | undefined, method: string, path: string): { handler: FauxRoute; params: Record<string, string> } | null {
    for (const [key, handler] of Object.entries(site?.api ?? {})) {
      const [routeMethod, template] = key.split(' ');
      if (routeMethod !== method) continue;
      const names: string[] = [];
      const source = template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
        names.push(name);
        return '([^/]+)';
      });
      const match = new RegExp(`^${source}$`).exec(path);
      if (match) return { handler, params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])])) };
    }
    return null;
  }

  private notify(event: NavigationEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private short(url: string): string {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}`;
  }
}
