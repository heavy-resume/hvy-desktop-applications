import type { Clock } from './clock';
import { readJsonPointer } from './endpoints';
import { errorMessage, WebAutomationError } from './errors';
import type { AutomationEmit } from './events';
import type { BrowserHost, NavigationEvent } from './host';
import { accountKey, type AutomationSettingsStore } from './settings';
import { capabilityOrigin, findEndpoint, signedOutStatuses, type ApiTransport, type WebApiCapability } from './webApi';

export type SessionStatus = 'unknown' | 'signed-out' | 'pending-login' | 'signed-in';

export interface SessionState {
  origin: string;
  profileId: string;
  status: SessionStatus;
  accountName: string | null;
  error: string | null;
}

interface PendingLogin {
  capability: WebApiCapability;
  profileId: string;
}

export class SessionService {
  private readonly states = new Map<string, SessionState>();
  private readonly pendingLogins = new Map<string, PendingLogin>();

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

  getState(): SessionState[] {
    return [...this.states.values()].map((state) => ({ ...state }));
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
      accountName: account?.accountName ?? null,
      error: null,
    };
  }

  async probe(capability: WebApiCapability, profileId: string): Promise<SessionState> {
    const session = this.requireSession(capability);
    const endpoint = findEndpoint(capability, session.probe.endpointId);
    try {
      const response = await this.deps.transport.call(capability, profileId, endpoint, {});
      if (signedOutStatuses(capability).includes(response.status)) {
        this.markSignedOut(capability, profileId);
      } else if (response.status >= 200 && response.status < 300) {
        const accountId = String(readJsonPointer(response.body, session.probe.accountIdPointer ?? '') ?? '');
        const accountName = String(readJsonPointer(response.body, session.probe.accountNamePointer ?? '') ?? accountId);
        const origin = capabilityOrigin(capability);
        this.deps.settings.update((settings) => ({
          ...settings,
          accounts: {
            ...settings.accounts,
            [accountKey(origin, profileId)]: { origin, profileId, accountId, accountName, checkedAt: this.deps.clock.now() },
          },
        }));
        this.setState(capability, profileId, { status: 'signed-in', accountName, error: null });
        this.deps.emit('session', `signed in as ${accountName}`, { origin, profileId });
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
    this.setState(capability, profileId, { status: 'signed-out', accountName: null });
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

  private setState(capability: WebApiCapability, profileId: string, patch: Partial<Omit<SessionState, 'origin' | 'profileId'>>): void {
    const current = this.stateFor(capability, profileId);
    this.states.set(accountKey(current.origin, profileId), { ...current, ...patch });
  }
}
