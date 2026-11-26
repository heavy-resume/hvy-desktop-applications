import type { Clock } from './clock';
import { errorMessage, WebAutomationError } from './errors';
import type { AutomationEmit } from './events';
import type { BrowserHost, NavigationEvent } from './host';
import { accountKey, type AutomationSettingsStore } from './settings';
import { capabilityOrigin, findEndpoint, signedOutStatuses, type ApiTransport, type WebApiCapability } from './webApi';

/**
 * How long an account check may take in all, waiting for its turn included. Each step has its own limit (a page load,
 * the request), but a check waits behind the profile's other calls first; past this it says the site could not be
 * reached, and can be checked again.
 */
export const SESSION_CHECK_TIMEOUT_MS = 45_000;

export type SessionStatus = 'unknown' | 'signed-out' | 'pending-login' | 'signed-in';

export interface SessionState {
  origin: string;
  profileId: string;
  status: SessionStatus;
  error: string | null;
}

interface PendingLogin {
  capability: WebApiCapability;
  profileId: string;
}

export class SessionService {
  private readonly states = new Map<string, SessionState>();
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private readonly listeners = new Set<(state: SessionState) => void>();

  constructor(private readonly deps: {
    host: BrowserHost;
    transport: ApiTransport;
    settings: AutomationSettingsStore;
    clock: Clock;
    emit: AutomationEmit;
  }) {
    deps.host.onNavigation((event) => {
      void this.handleNavigation(event);
    });
  }

  /** Called whenever an account's sign-in status changes. */
  onChange(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Every account known in this run, and every saved one: a saved account is signed in until a call says otherwise
   * (a signed-out status from any call signs it out), so it is not checked again on each start.
   */
  getState(): SessionState[] {
    const saved = Object.entries(this.deps.settings.get().accounts)
      .filter(([key]) => !this.states.has(key))
      .map(([, { origin, profileId }]): SessionState => ({ origin, profileId, status: 'signed-in', error: null }));
    return [...saved, ...[...this.states.values()].map((state) => ({ ...state }))];
  }

  stateFor(capability: WebApiCapability, profileId: string): SessionState {
    const origin = capabilityOrigin(capability);
    const existing = this.states.get(accountKey(origin, profileId));
    if (existing) return { ...existing };
    const account = this.deps.settings.get().accounts[accountKey(origin, profileId)];
    return {
      origin,
      profileId,
      status: account ? 'signed-in' : 'unknown',
      error: null,
    };
  }

  async probe(capability: WebApiCapability, profileId: string): Promise<SessionState> {
    const session = this.requireSession(capability);
    const endpoint = findEndpoint(capability, session.probe.endpointId);
    try {
      const controller = new AbortController();
      const deadline = this.deps.clock.sleep(SESSION_CHECK_TIMEOUT_MS, controller.signal).then(() => {
        throw new WebAutomationError('http_error', `Couldn’t reach ${capability.name}: no answer within ${SESSION_CHECK_TIMEOUT_MS / 1000}s.`, 0);
      });
      deadline.catch(() => undefined);
      const response = await Promise.race([this.deps.transport.call(capability, profileId, endpoint, {}, { interactive: true }), deadline])
        .finally(() => controller.abort());
      if (signedOutStatuses(capability).includes(response.status)) {
        this.markSignedOut(capability, profileId);
      } else if (response.status >= 200 && response.status < 300) {
        // Only access is checked here. Who is signed in, if the service says, is for the document's scripts to ask it.
        // The state is recorded before the account is saved, so listeners hear of a change from what they knew.
        const origin = capabilityOrigin(capability);
        this.setState(capability, profileId, { status: 'signed-in', error: null });
        this.deps.settings.update((settings) => ({
          ...settings,
          accounts: {
            ...settings.accounts,
            [accountKey(origin, profileId)]: { origin, profileId, checkedAt: this.deps.clock.now() },
          },
        }));
        this.deps.emit('session', 'signed in', { origin, profileId });
      } else {
        this.setState(capability, profileId, { error: `The session check returned ${response.status}.` });
      }
    } catch (error) {
      this.setState(capability, profileId, { error: errorMessage(error) });
    }
    return this.stateFor(capability, profileId);
  }

  async beginSignIn(capability: WebApiCapability, profileId: string): Promise<void> {
    const session = this.requireSession(capability);
    this.pendingLogins.set(profileId, { capability, profileId });
    this.setState(capability, profileId, { status: 'pending-login', error: null });
    this.deps.emit('session', 'login window opened', { profileId, url: session.loginUrl });
    await this.deps.host.openUserWindow(profileId, session.loginUrl);
  }

  async signOut(capability: WebApiCapability, profileId: string): Promise<void> {
    const session = this.requireSession(capability);
    if (session.logoutEndpointId) {
      await this.deps.transport.call(capability, profileId, findEndpoint(capability, session.logoutEndpointId), {});
    }
    this.markSignedOut(capability, profileId);
  }

  markSignedOut(capability: WebApiCapability, profileId: string): void {
    const origin = capabilityOrigin(capability);
    this.deps.settings.update((settings) => {
      const accounts = { ...settings.accounts };
      delete accounts[accountKey(origin, profileId)];
      return { ...settings, accounts };
    });
    if (this.stateFor(capability, profileId).status !== 'signed-out') this.deps.emit('session', 'signed out', { origin, profileId });
    this.setState(capability, profileId, { status: 'signed-out' });
  }

  private async handleNavigation(event: NavigationEvent): Promise<void> {
    const pending = this.pendingLogins.get(event.profileId);
    if (!pending || event.window !== 'user') return;
    const complete = new URL(this.requireSession(pending.capability).completeUrl);
    const actual = new URL(event.url);
    if (actual.origin !== complete.origin || actual.pathname !== complete.pathname) return;
    this.deps.emit('session', 'login completion signal received', { profileId: event.profileId });
    const state = await this.probe(pending.capability, pending.profileId);
    if (state.status !== 'signed-in') {
      this.setState(pending.capability, pending.profileId, { status: 'pending-login', error: state.error ?? 'The site did not confirm the sign-in.' });
      return;
    }
    this.pendingLogins.delete(event.profileId);
    await this.deps.host.hideUserWindow(event.profileId);
  }

  private requireSession(capability: WebApiCapability) {
    if (!capability.session) throw new WebAutomationError('invalid_request', `"${capability.name}" has no sign-in definition.`);
    return capability.session;
  }

  /**
   * Records an account's state and tells listeners when its status changes from what they knew: a saved account is
   * already "signed in" (a session handover gives them that), so checking it again tells them nothing new.
   */
  private setState(capability: WebApiCapability, profileId: string, patch: Partial<Omit<SessionState, 'origin' | 'profileId'>>): void {
    const previous = this.stateFor(capability, profileId);
    const next = { ...previous, ...patch };
    this.states.set(accountKey(previous.origin, profileId), next);
    if (next.status !== previous.status) for (const listener of this.listeners) listener({ ...next });
  }
}
