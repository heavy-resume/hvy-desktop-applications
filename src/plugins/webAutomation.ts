import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type { HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
import { openExternalUrl, readSystemClipboardText } from '../backend';
import { state } from '../state';
import { subscribeWebAutomation } from '../webAutomation/app';
import type { CollectionDefinition, CollectionField, CollectionRunState, CollectionSite, StartPageProgress, StartPage } from '../webAutomation/collection';
import type { AuthorizationReview } from '../webAutomation/authorization';
import { LIMIT_BOUNDS, readCollectionBlockConfig, readProfileContextBlockConfig, readQueueBlockConfig, readWebApiBlockConfig, switchToPublishedService, WEB_AUTOMATION_SCHEMA_VERSION } from '../webAutomation/configs';
import { createWebAutomationPlugins, resolveDocumentAutomation } from '../webAutomation/documentAutomation';
import { errorMessage } from '../webAutomation/errors';
import { isIgnoredProfileContext, profileContextFor } from '../webAutomation/profileContexts';
import { publishedService, SERVICE_MANIFEST_FORMAT, SERVICE_MANIFEST_PATH } from '../webAutomation/serviceManifests';
import { documentProfileName, resolveProfile, withDocumentProfile, type BrowserProfile } from '../webAutomation/profiles';
import { DEFAULT_QUEUE_CONFIG, type QueueEntry } from '../webAutomation/queue';
import type { DocumentAutomationLookup } from '../webAutomation/scripting';
import { canSetUpSites, setUpSite } from '../webAutomation/siteSetupOpener';
import {
  fieldsNotRead, newSiteId, patternsOf, startPagesReadBy, planSiteSetupPaste, readSiteSetupText, recognizeAddress, siteSetupOf, siteSetupText, startPageId, websitesOf, withSiteSetups, withoutSiteSetup,
  type SiteSetup, type SiteSetupPaste,
} from '../webAutomation/siteSetups';
import { capabilityOrigin, type WebApiCapability } from '../webAutomation/webApi';
import { button } from './webCapabilities';
import './webCapabilities.css';
import './webAutomation.css';

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className ? `hvy-web-automation-text ${className}` : 'hvy-web-automation-text';
  element.textContent = text;
  return element;
}

function heading(text: string): HTMLElement {
  const element = document.createElement('strong');
  element.textContent = text;
  return element;
}

function status(text: string): HTMLElement {
  const element = paragraph(text, 'hvy-web-automation-status');
  element.setAttribute('role', 'status');
  return element;
}

/** How long a "needs you" notice pulses when it first appears: a few soft rings, then it stays still. */
const NEEDS_YOU_PULSE_MS = 3_600;
/** When each notice first appeared, by document (its automation), so a reader redrawing does not restart its pulse. */
const needsYouSince = new WeakMap<object, Map<string, number>>();

/**
 * Something here waits for the user: a highlighted box beside the thing that needs them, which pulses briefly when it
 * first appears (not with reduced motion). `key` names the occurrence; a new one pulses again.
 */
function needsYouNotice(lookup: DocumentAutomationLookup, key: string, ...children: HTMLElement[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'hvy-web-needs-you';
  box.setAttribute('role', 'alert');
  const seen = needsYouSince.get(lookup.automation) ?? new Map<string, number>();
  needsYouSince.set(lookup.automation, seen);
  const since = seen.get(key) ?? Date.now();
  seen.set(key, since);
  const elapsed = Date.now() - since;
  if (elapsed < NEEDS_YOU_PULSE_MS) {
    box.classList.add('is-pulsing');
    // Continues the pulse where the last drawing left it.
    box.style.animationDelay = `-${elapsed}ms`;
  }
  box.append(...children);
  return box;
}

function actions(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'hvy-web-automation-actions';
  row.append(...buttons);
  return row;
}

/**
 * A reader that rerenders from the automation's published state: on every
 * automation event, and after the reader's own actions. Rendering opens the
 * document's automation, inside the document's state runtime.
 */
function reader(ctx: HvyPluginContext, render: (root: HTMLElement, lookup: DocumentAutomationLookup, sync: () => void) => void): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-web-capability hvy-web-automation';
  const lookup = resolveDocumentAutomation(ctx);
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    root.replaceChildren();
    render(root, lookup, sync);
  };
  const unsubscribe = subscribeWebAutomation(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  });
  sync();
  return { element: root, refresh: sync, unmount: unsubscribe };
}

function reviewReason(review: AuthorizationReview, name: string): string {
  if (review.reason === 'profile-changed') return 'You’re seeing this again because a different browser profile is selected.';
  if (review.reason === 'capability-changed') return `You’re seeing this again because what this file does with ${name} changed (${review.changedCategories.join(', ')}).`;
  return `You’re seeing this because this file has not used ${name} with this browser profile before.`;
}

/** Signs in: checks for a session in the profile first, and opens the site's sign-in window only without one. */
async function signInTo(lookup: DocumentAutomationLookup, capability: WebApiCapability): Promise<void> {
  const session = await lookup.automation.probeSession(capability);
  if (session.status !== 'signed-in') await lookup.automation.beginSignIn(capability);
}

/** A select of this machine's browser profiles, by name (as the document names them), starting on `current`. */
function profileSelect(current: string | null): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'hvy-galaxy-select';
  select.name = 'profile';
  select.required = true;
  const choose = document.createElement('option');
  choose.value = '';
  choose.textContent = 'Choose a profile';
  select.append(choose, ...state.integrationRegistry.profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.name;
    option.textContent = profile.name;
    option.selected = profile.name === current;
    return option;
  }));
  return select;
}

/** This machine's browser profiles, as the document's names resolve against them. */
function localProfiles(): BrowserProfile[] {
  return state.integrationRegistry.profiles.map(({ id, name }) => ({ id, name }));
}

/**
 * The one dialog where a browser profile is chosen: the file's, or a web profile context's. The choice is saved in
 * the document by name; a site is asked about again before it is used with another profile.
 */
function openProfileDialog(options: { current: string | null; note: string; onChosen(name: string): void }): void {
  const { form, body, row, close } = openModal('Browser profile', 'hvy-web-profile-dialog');
  const select = profileSelect(options.current);
  const label = document.createElement('label');
  label.className = 'hvy-web-profile';
  const name = document.createElement('span');
  name.textContent = 'Browser profile';
  label.append(name, select);
  body.append(label, paragraph(options.note, 'hvy-web-page-hint'));
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const save = button('Confirm', true);
  save.type = 'submit';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!select.value) return;
    close();
    options.onChosen(select.value);
  });
  row.append(cancel, save);
  select.focus();
}

const KEPT_BY_NAME = 'The document keeps it by name. A site is asked about again before it is used with another profile.';

/** The file's profile, for the web plugins outside any web profile context, saved in the front matter. */
function chooseFileProfile(ctx: HvyPluginContext, lookup: DocumentAutomationLookup, then: () => void = () => {}): void {
  openProfileDialog({
    current: documentProfileName(ctx.rawDocument.meta),
    note: `For the web plugins in this file outside a web profile context. ${KEPT_BY_NAME}`,
    onChosen: (name) => {
      ctx.header.set('metadata', withDocumentProfile(ctx.header.get('metadata'), name));
      lookup.automation.profileChosen(name, 'this file');
      then();
    },
  });
}

const WAITING_FOR_CONTEXT = 'Waiting for a browser profile from the web profile context of this section or container.';

/**
 * Which browser profile a web plugin uses, where that is a choice: with several profiles on this machine, or before
 * one is chosen. Inside a web profile context, the context is where it is chosen.
 */
function profileLine(ctx: HvyPluginContext, lookup: DocumentAutomationLookup, capabilityId: string): HTMLElement[] {
  const current = lookup.automation.profileOf(capabilityId);
  const several = state.integrationRegistry.profiles.length > 1;
  if (profileContextFor(ctx.rawDocument, ctx.block)) {
    if (!current) return [status(WAITING_FOR_CONTEXT)];
    return several ? [paragraph(`Browser profile: ${current.name}, from the web profile context here`, 'hvy-web-page-hint')] : [];
  }
  if (current && !several) return [];
  const change = button(current ? 'Change profile…' : 'Choose a browser profile…', !current);
  change.addEventListener('click', () => chooseFileProfile(ctx, lookup));
  return [paragraph(current ? `Browser profile: ${current.name}` : 'No browser profile chosen yet.', 'hvy-web-page-hint'), actions(change)];
}

/**
 * Allow this file to use a web API's site, in the browser profile the document names for it, shown so it can be
 * checked. A block with a sign-in then signs in, if the profile is not signed in already. Explicit modal, as for
 * Galaxy's other web capabilities; it asks again when the profile or what the block does changes.
 */
function openApprovalDialog(lookup: DocumentAutomationLookup, capability: WebApiCapability, profile: BrowserProfile, onOutcome: (problem: string) => void): void {
  if (!state.document) return;
  const { form, body, row, close } = openModal(capability.session ? `Let this file use your ${capability.name} account?` : `Let this file use ${capability.name}?`, 'hvy-web-authorization-dialog wide-dialog');
  const details = document.createElement('dl');
  const rows: Array<[string, string]> = [
    ['Document', state.document.source.name],
    ['Browser profile', profile.name],
    // The page you are sent to, in full, so its address can be checked before signing in.
    capability.session ? ['Sign-in page', capability.session.loginUrl] : ['Website', capability.pageUrl],
    // A published service's permissions, in its own words; otherwise the endpoints the file declares.
    ['What it can do', capability.published
      ? capability.published.permissions.map((permission) => `${permission.description}${permission.changesData ? ' (can change your data there)' : ''}`).join('; ')
      : capability.endpoints.map((endpoint) => endpoint.name).join(', ')],
    ...(capability.readOrigins?.length ? [['Also reads from', capability.readOrigins.map((origin) => new URL(origin).host).join(', ')] as [string, string]] : []),
  ];
  for (const [term, description] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description;
    details.append(dt, dd);
  }
  body.append(
    paragraph(capability.session
      ? `This file asks to call ${capability.name} as you, with your sign-in in the ${profile.name} browser profile. Nothing is called until you allow it.`
      : `This file asks to call ${capability.name} from the ${profile.name} browser profile. Nothing is called until you allow it.`, 'hvy-web-authorization-reason'),
    details,
    paragraph(`${reviewReason(lookup.automation.reviewWebApi(capability), capability.name)} What the file sends and keeps is in the document.`, 'hvy-web-page-hint'),
  );
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  // Allowing checks the account first: the sign-in window opens only when the profile is not signed in there.
  const allow = button('Allow', true);
  allow.type = 'submit';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    lookup.automation.authorizeWebApi(capability);
    close();
    if (capability.session) signInTo(lookup, capability).catch((error: unknown) => onOutcome(errorMessage(error)));
    // Nothing follows: the reader shows the block as ready.
    else onOutcome('');
  });
  row.append(cancel, allow);
  allow.focus();
}

/**
 * A web profile context: the browser profile for the web plugins in its section or container, and anything nested
 * there. Chosen here; the document keeps it by name.
 */
const profileContextView: HvyPluginFactory = (ctx) => reader(ctx, (root, lookup) => {
  const result = readProfileContextBlockConfig(ctx.block.schema.pluginConfig);
  if (!result.ok) {
    root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
    return;
  }
  const name = result.value.profile ?? null;
  const profile = resolveProfile(name, localProfiles());
  const choose = button(profile ? 'Change profile…' : 'Choose a browser profile…', !profile);
  choose.addEventListener('click', () => openProfileDialog({
    current: profile?.name ?? name,
    note: `For the web plugins in this section or container. ${KEPT_BY_NAME}`,
    onChosen: (chosen) => {
      ctx.setConfig({ schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION, profile: chosen });
      lookup.automation.profileChosen(chosen, 'a web profile context');
    },
  }));
  const ignored = isIgnoredProfileContext(ctx.rawDocument, ctx.block);
  root.append(
    heading('Browser profile'),
    status(ignored
      ? 'Another web profile context comes first in this section or container, so this one sets nothing.'
      : profile
        ? `${profile.name}, for the web plugins in this section or container.`
        : name ? `No browser profile here is called “${name}”.` : 'No browser profile chosen yet.'),
    actions(choose),
  );
});

const ENDPOINT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
/** An endpoint's fields the dialog edits on their own; the rest (idempotency, a served document, an error pointer) are JSON. */
const ENDPOINT_FIELDS = ['id', 'name', 'description', 'method', 'path', 'inputSchema', 'timeoutMs'];

function textArea(name: string, value: string, rows: number): HTMLTextAreaElement {
  const area = document.createElement('textarea');
  area.className = 'hvy-galaxy-input hvy-web-json';
  area.name = name;
  area.rows = rows;
  area.value = value;
  return area;
}

function select(name: string, options: Array<[string, string]>, current: string): HTMLSelectElement {
  const element = document.createElement('select');
  element.className = 'hvy-galaxy-select';
  element.name = name;
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = value === current;
    element.append(option);
  }
  return element;
}

function checkboxRow(text: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'checkbox-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'hvy-galaxy-input';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return label;
}

function fieldset(legendText: string, ...children: HTMLElement[]): HTMLFieldSetElement {
  const box = document.createElement('fieldset');
  box.className = 'hvy-web-page-values';
  const legend = document.createElement('legend');
  legend.textContent = legendText;
  box.append(legend, ...children);
  return box;
}

const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Parses a JSON object from a textarea, or says why it could not. */
function jsonObject(value: string, what: string): { value: Record<string, unknown> } | { error: string } {
  if (!value.trim()) return { value: {} };
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? { value: parsed } : { error: `${what} must be a JSON object.` };
  } catch (error) {
    return { error: `${what} is not valid JSON: ${errorMessage(error)}` };
  }
}

/** A block's configuration being edited in place. */
interface ConfigEditing {
  /** The configuration as stored now. */
  config: Record<string, unknown>;
  /** Makes a change, kept only when the block accepts it. Returns why it was refused, if it was. */
  commit(change: (draft: Record<string, unknown>) => void): string[];
  /** Why the last change was refused: the editor places it under its heading. */
  problem: HTMLElement;
}

/**
 * A web plugin's configuration edited in place, in the editor. `render` draws it from the stored configuration; each
 * change is checked as the block's loader and `hvy lint` check it (`read`) and kept only when it passes, otherwise the
 * reason shows and the block stays as it was. A key a change removes is set to undefined, since the stored
 * configuration is merged with the change.
 */
function configEditor(
  ctx: HvyPluginContext,
  read: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
  className: string,
  render: (root: HTMLElement, editing: ConfigEditing) => void,
): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-web-capability hvy-web-automation hvy-web-config-editor ${className}`;
  // Why the last change was refused, kept across the redraw that follows it.
  let refused = '';
  const stored = () => structuredClone(ctx.block.schema.pluginConfig) as Record<string, unknown>;
  const commit = (change: (draft: Record<string, unknown>) => void): string[] => {
    const draft = stored();
    change(draft);
    const result = read(draft);
    refused = result.ok ? '' : result.errors.join(' ');
    if (result.ok) ctx.setConfig(draft as JsonObject);
    draw();
    return result.ok ? [] : result.errors;
  };
  const draw = () => {
    root.replaceChildren();
    const problem = paragraph(refused, 'hvy-web-error');
    problem.setAttribute('role', 'alert');
    render(root, { config: stored(), commit, problem });
  };
  draw();
  return { element: root, refresh: draw };
}

/** A number input whose stored value is in milliseconds, shown in seconds. */
function secondsInput(name: string, milliseconds: unknown, max: number): HTMLInputElement {
  const input = textInput(name, typeof milliseconds === 'number' ? String(milliseconds / 1000) : '');
  input.type = 'number';
  input.min = '0';
  input.max = String(max);
  input.step = 'any';
  return input;
}

/**
 * The inline editor's offer when the page's service publishes what documents may do: use that instead of the calls
 * described in the file, asking for the permissions checked (at first, those that cover the block's endpoints). The
 * block keeps its id, and what AI tools may call within what the permissions grant.
 */
function publishedOffer(origin: string, manifest: Record<string, unknown>, endpoints: Record<string, unknown>[], commit: ConfigEditing['commit']): HTMLElement[] {
  const offered = (Array.isArray(manifest.permissions) ? manifest.permissions : []).filter(isObject);
  if (!offered.length) return [];
  const granted = (permission: Record<string, unknown>) => (Array.isArray(permission.endpoints) ? permission.endpoints.map(String) : []);
  const current = new Set(endpoints.map((endpoint) => String(endpoint.id)));
  const chosen = new Set(offered.filter((permission) => granted(permission).some((id) => current.has(id))).map((permission) => String(permission.id)));
  const rows = offered.map((permission) => checkboxRow(String(permission.description ?? permission.id), chosen.has(String(permission.id)), (on) => {
    if (on) chosen.add(String(permission.id));
    else chosen.delete(String(permission.id));
  }));
  const use = button('Use what it publishes', true);
  use.addEventListener('click', () => commit((draft) => {
    Object.assign(draft, switchToPublishedService(draft, origin, manifest, [...chosen]));
  }));
  return [fieldset('Published by the service',
    paragraph(`${String(manifest.name ?? new URL(origin).host)} publishes what documents may do with it. Use that instead of the calls described here: the service decides what each permission allows, and this file asks for the ones checked.`, 'hvy-web-page-hint'),
    ...rows,
    actions(use))];
}

/** The site (origin) of an address, or null when it is not one. */
function originOf(address: unknown): string | null {
  try {
    return new URL(String(address)).origin;
  } catch {
    return null;
  }
}

/** "Try again" for a service whose published file could not be read: it is fetched again. */
function tryAgain(lookup: DocumentAutomationLookup, origin: string): HTMLElement {
  const again = button('Try again', true);
  again.addEventListener('click', () => void lookup.automation.fetchPublishedService(origin, true));
  return actions(again);
}

/**
 * A Web API block that uses a service's published file, in the editor: the service, the permissions it asks for (as
 * the service describes them), and which of their endpoints AI tools may call. The service decides what each
 * permission allows; asking for another one is approved again before the file uses it.
 */
function publishedServiceEditor(ctx: HvyPluginContext, root: HTMLElement, { config, commit, problem }: ConfigEditing): void {
  const service = textInput('service', String(config.service ?? ''));
  service.type = 'url';
  service.addEventListener('change', () => commit((draft) => {
    draft.service = service.value.trim();
  }));
  const origin = originOf(config.service);
  const published = origin ? publishedService(origin) : null;
  const asked = Array.isArray(config.permissions) ? config.permissions.map(String) : [];
  const exposed = isObject(config.mcp) && Array.isArray(config.mcp.endpointIds) ? config.mcp.endpointIds.map(String) : [];
  const offered = published?.status === 'loaded' && Array.isArray(published.manifest.permissions) ? published.manifest.permissions.filter(isObject) : [];
  const permissions = published?.status === 'loaded'
    ? offered.map((permission) => {
      const id = String(permission.id ?? '');
      return checkboxRow(String(permission.description ?? id), asked.includes(id), (on) => commit((draft) => {
        draft.permissions = on ? [...asked, id] : asked.filter((candidate) => candidate !== id);
      }));
    })
    : published?.status === 'failed'
      ? [paragraph(`Couldn’t read its published file: ${published.error}`, 'hvy-web-error'), tryAgain(resolveDocumentAutomation(ctx), origin!)]
      : [paragraph('Reading its published file…', 'hvy-web-page-hint')];
  // The endpoints the permissions asked for grant, once the file is read.
  const read = readWebApiBlockConfig(config);
  const endpoints = read.ok && read.value.capability ? read.value.capability.endpoints : [];
  const tools = endpoints.map((endpoint) => checkboxRow(`AI tools can call ${endpoint.name}`, exposed.includes(endpoint.id), (on) => commit((draft) => {
    draft.mcp = { ...(isObject(draft.mcp) ? draft.mcp : {}), endpointIds: on ? [...exposed, endpoint.id] : exposed.filter((candidate) => candidate !== endpoint.id) };
  })));
  root.append(
    heading(read.ok && read.value.capability ? read.value.capability.name : (origin ? new URL(origin).host : 'Web API')),
    paragraph(`Id: ${String(config.capabilityId ?? '')}. Uses what the service publishes about itself (${SERVICE_MANIFEST_PATH} on its site): the file asks for permissions, and the service decides what they allow.`, 'hvy-web-page-hint'),
    problem,
    fieldset('Service', labelled('Service address', service, 'The service’s site.')),
    fieldset('Permissions it asks for', ...permissions),
    ...(tools.length ? [fieldset('AI tools', ...tools)] : []),
  );
}

/**
 * The Web API block in the editor: its service, sign-in, endpoints, and what AI tools may call. A changed
 * configuration is approved again before the file uses the service.
 */
function webApiEditor(ctx: HvyPluginContext): HvyPluginInstance {
  const instance = configEditor(ctx, readWebApiBlockConfig, 'hvy-web-api-editor', (root, editing) => {
    // A block that uses a service's published file edits what it asks of the service; an inline block, its snapshot.
    if (editing.config.service !== undefined) {
      publishedServiceEditor(ctx, root, editing);
      return;
    }
    const { config, commit, problem } = editing;
    const endpoints = (Array.isArray(config.endpoints) ? config.endpoints : []).filter(isObject);
    const session = isObject(config.session) ? config.session : null;
    const exposed = isObject(config.mcp) && Array.isArray(config.mcp.endpointIds) ? config.mcp.endpointIds.map(String) : [];
    const pageOrigin = originOf(config.pageUrl) ?? '';
    // Whether the page's service publishes what documents may do (asked once); if it does, the offer to use that.
    const publishedHere = pageOrigin ? publishedService(pageOrigin) : null;
    if (pageOrigin && !publishedHere) void resolveDocumentAutomation(ctx).automation.fetchPublishedService(pageOrigin);
    const offer = publishedHere?.status === 'loaded' && publishedHere.manifest.hvy === SERVICE_MANIFEST_FORMAT
      ? publishedOffer(pageOrigin, publishedHere.manifest, endpoints, commit)
      : [];

    // The service.
    const name = textInput('name', String(config.name ?? ''));
    name.addEventListener('change', () => commit((draft) => {
      draft.name = name.value.trim();
    }));
    const pageUrl = textInput('pageUrl', String(config.pageUrl ?? ''));
    pageUrl.type = 'url';
    pageUrl.addEventListener('change', () => commit((draft) => {
      draft.pageUrl = pageUrl.value.trim();
    }));
    const readOrigins = textArea('readOrigins', (Array.isArray(config.readOrigins) ? config.readOrigins.map(String) : []).join('\n'), 2);
    readOrigins.addEventListener('change', () => commit((draft) => {
      draft.readOrigins = lines(readOrigins.value).length ? lines(readOrigins.value) : undefined;
    }));

    // The sign-in.
    const getEndpoints = endpoints.filter((endpoint) => String(endpoint.method ?? '').toUpperCase() === 'GET');
    const signIn: HTMLElement[] = [checkboxRow('Has a sign-in', Boolean(session), (on) => commit((draft) => {
      draft.session = on
        ? { loginUrl: `${pageOrigin}/login`, completeUrl: `${pageOrigin}/`, probe: { endpointId: String(getEndpoints[0]?.id ?? '') } }
        : undefined;
    }))];
    if (session) {
      const sessionField = (key: 'loginUrl' | 'completeUrl') => {
        const input = textInput(key, String(session[key] ?? ''));
        input.type = 'url';
        input.addEventListener('change', () => commit((draft) => {
          (draft.session as Record<string, unknown>)[key] = input.value.trim();
        }));
        return input;
      };
      const probe = isObject(session.probe) ? session.probe : {};
      const statuses = textInput('signedOutStatuses', (Array.isArray(probe.signedOutStatuses) ? probe.signedOutStatuses : []).join(', '));
      statuses.placeholder = '401 (default)';
      statuses.addEventListener('change', () => commit((draft) => {
        const draftSession = draft.session as Record<string, unknown>;
        const numbers = statuses.value.split(',').map((part) => Number(part.trim())).filter((status) => Number.isInteger(status));
        draftSession.probe = { ...(isObject(draftSession.probe) ? draftSession.probe : {}), signedOutStatuses: numbers.length ? numbers : undefined };
      }));
      signIn.push(
        labelled('Sign-in page', sessionField('loginUrl'), 'Where the user signs in, on the service’s site.'),
        labelled('Page after signing in', sessionField('completeUrl'), 'Reaching it means the sign-in finished.'),
        labelled('Signed-out statuses', statuses, 'The session check’s answers that mean signed out.'),
        paragraph('Which endpoint checks the session, and which signs out, is chosen on the endpoints above.', 'hvy-web-page-hint'),
      );
    }

    // The endpoints.
    const list = document.createElement('div');
    list.setAttribute('role', 'list');
    list.className = 'hvy-web-queue-entries';
    for (const endpoint of endpoints) {
      const id = String(endpoint.id ?? '');
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      item.className = 'hvy-web-queue-entry';
      const edit = button('Edit');
      edit.addEventListener('click', () => openEndpointDialog(endpoint));
      const remove = button('Remove');
      remove.addEventListener('click', () => commit((draft) => {
        draft.endpoints = (draft.endpoints as unknown[]).filter((candidate) => !isObject(candidate) || candidate.id !== id);
        draft.mcp = { ...(isObject(draft.mcp) ? draft.mcp : {}), endpointIds: exposed.filter((candidate) => candidate !== id) };
      }));
      // Its part in the sign-in: the session check (a GET endpoint that fails while signed out), or sign-out.
      const role = session
        ? select('role', [['', 'Nothing else'], ...(String(endpoint.method ?? '').toUpperCase() === 'GET' ? [['probe', 'Checking the session'] as [string, string]] : []), ['logout', 'Signing out']],
          isObject(session.probe) && session.probe.endpointId === id ? 'probe' : session.logoutEndpointId === id ? 'logout' : '')
        : null;
      role?.addEventListener('change', () => commit((draft) => {
        const draftSession = draft.session as Record<string, unknown>;
        const draftProbe = isObject(draftSession.probe) ? draftSession.probe : {};
        if (role.value === 'probe') draftSession.probe = { ...draftProbe, endpointId: id };
        if (role.value === 'logout') draftSession.logoutEndpointId = id;
        // No longer the session check leaves the sign-in without one, which is refused with the reason.
        if (role.value !== 'probe' && draftProbe.endpointId === id) draftSession.probe = { ...draftProbe, endpointId: '' };
        if (role.value !== 'logout' && draftSession.logoutEndpointId === id) draftSession.logoutEndpointId = undefined;
      }));
      item.append(
        paragraph(String(endpoint.name ?? id), 'hvy-web-automation-entry'),
        paragraph(`${String(endpoint.method ?? '')} ${String(endpoint.path ?? '')}`, 'hvy-web-page-hint'),
        ...(role ? [labelled('Also used for', role)] : []),
        checkboxRow('AI tools can call it', exposed.includes(id), (on) => commit((draft) => {
          draft.mcp = { ...(isObject(draft.mcp) ? draft.mcp : {}), endpointIds: on ? [...exposed, id] : exposed.filter((candidate) => candidate !== id) };
        })),
        actions(edit, remove),
      );
      list.append(item);
    }
    const add = button('+ Add endpoint');
    add.addEventListener('click', () => openEndpointDialog(null));

    root.append(
      heading(String(config.name ?? 'Web API')),
      paragraph(`Id: ${String(config.capabilityId ?? '')}. Scripts and queues call it by this id. A changed configuration is approved again before the file uses the service.`, 'hvy-web-page-hint'),
      problem,
      ...offer,
      fieldset('Service',
        labelled('Name', name),
        labelled('Page address', pageUrl, 'The service’s page that calls are made from.'),
        labelled('Other sites it reads from', readOrigins, 'One per line. Galaxy reads what the service points it to on these sites, without your sign-in and keeping nothing: such as a document the service stores elsewhere.')),
      fieldset('Endpoints', ...(endpoints.length ? [list] : [paragraph('No endpoints yet.', 'hvy-web-page-hint')]), actions(add)),
      fieldset('Sign-in', ...signIn),
    );

    /** An endpoint's own dialog: its fields, its inputs as JSON Schema, and the rest as JSON. Confirming checks the whole block. */
    function openEndpointDialog(endpoint: Record<string, unknown> | null): void {
      const { form, body, errors, row, close } = openModal(endpoint ? `Endpoint: ${String(endpoint.name ?? endpoint.id)}` : 'New endpoint', 'hvy-web-page-dialog wide-dialog');
      const field = (key: string, value: unknown) => textInput(key, value === undefined ? '' : String(value));
      const id = field('id', endpoint?.id);
      const endpointName = field('name', endpoint?.name);
      const description = field('description', endpoint?.description);
      const method = select('method', ENDPOINT_METHODS.map((value): [string, string] => [value, value]), String(endpoint?.method ?? 'GET'));
      const path = field('path', endpoint?.path);
      path.placeholder = '/api/items/{id}';
      const timeout = secondsInput('timeout', endpoint?.timeoutMs, 60);
      timeout.min = '1';
      timeout.placeholder = '15 (default)';
      const inputs = textArea('inputSchema', JSON.stringify(endpoint?.inputSchema ?? { type: 'object', properties: {} }, null, 2), 8);
      const rest = Object.fromEntries(Object.entries(endpoint ?? {}).filter(([key]) => !ENDPOINT_FIELDS.includes(key)));
      const more = textArea('more', Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '', 6);
      more.placeholder = '{ "idempotency": { "header": "Idempotency-Key" } }';
      body.append(
        labelled('Id', id, 'How scripts and queues name it.'),
        labelled('Name', endpointName),
        labelled('Description', description),
        labelled('Method', method, 'Anything but GET can change data on the site as the user.'),
        labelled('Path', path, 'On the page’s site. {name} takes the input of that name.'),
        labelled('Timeout (seconds)', timeout),
        labelled('Inputs (JSON Schema)', inputs, 'Its properties are the only inputs the endpoint accepts.'),
        labelled('More (JSON)', more, 'Idempotency, a served document, or an error message pointer.'),
      );
      const cancel = button('Cancel');
      cancel.addEventListener('click', close);
      const confirm = button('Confirm', true);
      confirm.type = 'submit';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const schema = jsonObject(inputs.value, 'Inputs');
        const extra = jsonObject(more.value, 'More');
        if ('error' in schema || 'error' in extra) {
          errors.textContent = ['error' in schema ? schema.error : '', 'error' in extra ? extra.error : ''].filter(Boolean).join(' ');
          return;
        }
        const previousId = endpoint ? String(endpoint.id ?? '') : null;
        const next: Record<string, unknown> = {
          ...extra.value,
          id: id.value.trim(),
          name: endpointName.value.trim(),
          description: description.value.trim(),
          method: method.value,
          path: path.value.trim(),
          inputSchema: schema.value,
          ...(timeout.value.trim() ? { timeoutMs: Number(timeout.value) * 1000 } : {}),
        };
        const problems = commit((draft) => {
          const current = (Array.isArray(draft.endpoints) ? draft.endpoints : []) as unknown[];
          draft.endpoints = previousId === null ? [...current, next] : current.map((candidate) => (isObject(candidate) && candidate.id === previousId ? next : candidate));
          // A renamed endpoint keeps its place in the sign-in and in what AI tools may call.
          if (previousId !== null && previousId !== next.id) {
            if (isObject(draft.session)) {
              const draftSession = draft.session;
              if (isObject(draftSession.probe) && draftSession.probe.endpointId === previousId) draftSession.probe = { ...draftSession.probe, endpointId: next.id };
              if (draftSession.logoutEndpointId === previousId) draftSession.logoutEndpointId = next.id;
            }
            if (isObject(draft.mcp) && Array.isArray(draft.mcp.endpointIds)) draft.mcp = { ...draft.mcp, endpointIds: draft.mcp.endpointIds.map((candidate) => (candidate === previousId ? next.id : candidate)) };
          }
        });
        if (problems.length) errors.textContent = problems.join(' ');
        else close();
      });
      row.append(cancel, confirm);
      id.focus();
    }
  });
  // A published service's file arriving (or failing) redraws the editor: its permissions are read from it.
  const unsubscribe = subscribeWebAutomation((event) => {
    if (event.source === 'document') instance.refresh?.();
  });
  return { ...instance, unmount: unsubscribe };
}

/** The queue block in the editor: what it calls, how its calls are paced, and how failures are retried. */
function queueEditor(ctx: HvyPluginContext): HvyPluginInstance {
  return configEditor(ctx, readQueueBlockConfig, 'hvy-web-queue-editor', (root, { config, commit, problem }) => {
    const target = isObject(config.target) ? config.target : {};
    const pacing = isObject(config.config) ? config.config : {};
    const retry = isObject(pacing.retry) ? pacing.retry : {};
    const defaults = DEFAULT_QUEUE_CONFIG;
    // A change to the pacing or the retries, in the stored `config`.
    const setPacing = (change: (pacing: Record<string, unknown>) => void) => commit((draft) => {
      const next = isObject(draft.config) ? draft.config : {};
      change(next);
      draft.config = next;
    });
    const setRetry = (change: (retry: Record<string, unknown>) => void) => setPacing((next) => {
      const nextRetry = isObject(next.retry) ? next.retry : {};
      change(nextRetry);
      next.retry = nextRetry;
    });
    const number = (name: string, value: unknown, min: number, max: number, placeholder: number) => {
      const input = textInput(name, typeof value === 'number' ? String(value) : '');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.placeholder = `${placeholder} (default)`;
      return input;
    };
    const asNumber = (input: HTMLInputElement, scale = 1) => (input.value.trim() ? Number(input.value) * scale : undefined);

    const pluginId = textInput('pluginId', String(target.pluginId ?? ''));
    const method = textInput('method', String(target.method ?? ''));
    const args = textArea('args', JSON.stringify(target.args ?? {}, null, 2), 4);
    const setTarget = () => {
      const parsed = jsonObject(args.value, 'Arguments');
      if ('error' in parsed) {
        problem.textContent = parsed.error;
        return;
      }
      commit((draft) => {
        draft.target = { pluginId: pluginId.value.trim(), method: method.value.trim(), args: parsed.value };
      });
    };
    for (const input of [pluginId, method, args]) input.addEventListener('change', setTarget);

    const concurrency = number('concurrency', pacing.concurrency, 1, 4, defaults.concurrency);
    concurrency.addEventListener('change', () => setPacing((next) => {
      next.concurrency = asNumber(concurrency);
    }));
    const interval = secondsInput('minIntervalMs', pacing.minIntervalMs, 3_600);
    interval.placeholder = `${defaults.minIntervalMs / 1000} (default)`;
    interval.addEventListener('change', () => setPacing((next) => {
      next.minIntervalMs = asNumber(interval, 1000);
    }));
    const jitter = secondsInput('jitterMs', pacing.jitterMs, 600);
    jitter.placeholder = `${defaults.jitterMs / 1000} (default)`;
    jitter.addEventListener('change', () => setPacing((next) => {
      next.jitterMs = asNumber(jitter, 1000);
    }));

    const listText = (value: unknown, fallback: unknown[]) => (Array.isArray(value) ? value : fallback).join(', ');
    const statuses = textInput('statuses', listText(retry.statuses, defaults.retry.statuses));
    statuses.addEventListener('change', () => setRetry((next) => {
      next.statuses = statuses.value.split(',').map((part) => Number(part.trim())).filter((status) => Number.isInteger(status));
    }));
    const codes = textInput('codes', listText(retry.codes, defaults.retry.codes));
    codes.addEventListener('change', () => setRetry((next) => {
      next.codes = codes.value.split(',').map((part) => part.trim()).filter(Boolean);
    }));
    const attempts = number('maxAttempts', retry.maxAttempts, 1, 10, defaults.retry.maxAttempts);
    attempts.addEventListener('change', () => setRetry((next) => {
      next.maxAttempts = asNumber(attempts);
    }));
    const firstWait = secondsInput('baseDelayMs', retry.baseDelayMs, 3_600);
    firstWait.placeholder = `${defaults.retry.baseDelayMs / 1000} (default)`;
    firstWait.addEventListener('change', () => setRetry((next) => {
      next.baseDelayMs = asNumber(firstWait, 1000);
    }));
    const longestWait = secondsInput('maxDelayMs', retry.maxDelayMs, 86_400);
    longestWait.placeholder = `${defaults.retry.maxDelayMs / 1000} (default)`;
    longestWait.addEventListener('change', () => setRetry((next) => {
      next.maxDelayMs = asNumber(longestWait, 1000);
    }));

    root.append(
      heading(`Queue: ${String(config.queueId ?? '')}`),
      paragraph('Scripts add work to it by this id.', 'hvy-web-page-hint'),
      problem,
      fieldset('What it calls',
        labelled('Plugin', pluginId, 'Another plugin in this file, such as galaxy.web-api.'),
        labelled('Method', method, 'Its method each entry calls, such as call.'),
        labelled('Arguments (JSON)', args, 'Sent with every call, beside the entry’s input: such as the web API and endpoint.')),
      fieldset('Pacing',
        labelled('Calls at once', concurrency),
        labelled('Seconds between calls', interval),
        labelled('Random extra seconds', jitter, 'Up to this much more between calls, so they do not come at a fixed beat.')),
      fieldset('Retries',
        labelled('Retry on statuses', statuses, 'Comma-separated, such as 429, 503.'),
        labelled('Retry on error codes', codes, 'Comma-separated.'),
        labelled('Attempts', attempts, 'In all, the first one included.'),
        labelled('First retry after (seconds)', firstWait, 'Each retry waits twice as long as the one before.'),
        labelled('Longest wait (seconds)', longestWait)),
    );
  });
}

/**
 * The collection block's settings in the editor: its name, what an item is called, its fields, how a record is told
 * apart, where its records go, and whether AI tools may run it. Its pages, site setups, and limits are edited in its
 * reader below, as in the viewer.
 */
function collectionSettingsEditor(ctx: HvyPluginContext): HvyPluginInstance {
  return configEditor(ctx, readCollectionBlockConfig, 'hvy-web-collection-editor', (root, { config, commit, problem }) => {
    const fields = (Array.isArray(config.fields) ? config.fields : []).filter(isObject);
    const name = textInput('name', String(config.name ?? ''));
    name.addEventListener('change', () => commit((draft) => {
      draft.name = name.value.trim();
    }));
    const itemName = textInput('itemName', String(config.itemName ?? ''));
    itemName.placeholder = 'item (default)';
    itemName.addEventListener('change', () => commit((draft) => {
      draft.itemName = itemName.value.trim() || undefined;
    }));
    const fieldsJson = textArea('fields', JSON.stringify(fields, null, 2), 6);
    fieldsJson.addEventListener('change', () => {
      try {
        const parsed: unknown = JSON.parse(fieldsJson.value);
        commit((draft) => {
          draft.fields = parsed;
        });
      } catch (error) {
        problem.textContent = `Fields is not valid JSON: ${errorMessage(error)}`;
      }
    });
    const key = isObject(config.key) ? config.key : { kind: 'url' };
    const keyValue = key.kind === 'field' ? `field:${String(key.field)}` : key.kind === 'fields' ? 'fields' : 'url';
    const identity = select('key', [
      ['url', 'Its page’s address'],
      ...fields.map((field): [string, string] => [`field:${String(field.id)}`, `Its ${String(field.label ?? field.id)}`]),
      ...(key.kind === 'fields' ? [['fields', `Its ${(Array.isArray(key.fields) ? key.fields : []).join(' and ')}`] as [string, string]] : []),
    ], keyValue);
    identity.addEventListener('change', () => commit((draft) => {
      if (identity.value === 'fields') return;
      draft.key = identity.value === 'url' ? undefined : { kind: 'field', field: identity.value.slice('field:'.length) };
    }));
    const ignored = textArea('ignoredQueryParameters', (Array.isArray(config.ignoredQueryParameters) ? config.ignoredQueryParameters.map(String) : []).join('\n'), 2);
    ignored.placeholder = 'Tracking parameters (default)';
    ignored.addEventListener('change', () => commit((draft) => {
      draft.ignoredQueryParameters = lines(ignored.value).length ? lines(ignored.value) : undefined;
    }));
    const output = textArea('output', config.output === undefined ? '' : JSON.stringify(config.output, null, 2), 8);
    output.placeholder = 'Records go to the script that runs the collection.';
    output.addEventListener('change', () => {
      const parsed = jsonObject(output.value, 'Output');
      if ('error' in parsed) {
        problem.textContent = parsed.error;
        return;
      }
      commit((draft) => {
        draft.output = Object.keys(parsed.value).length ? parsed.value : undefined;
      });
    });
    root.append(
      heading(`Settings: ${String(config.name ?? 'Collection')}`),
      paragraph(`Id: ${String(config.capabilityId ?? '')}. Scripts collect by this id.`, 'hvy-web-page-hint'),
      problem,
      fieldset('Collection',
        labelled('Name', name),
        labelled('What one item is called', itemName, 'Such as job: used in the pages and setup wording.'),
        labelled('Fields (JSON)', fieldsJson, 'What each record holds: [{ "id": "title", "label": "Title" }, …]. Long text: "kind": "long-text".'),
        labelled('A record is the same as another by', identity),
        labelled('Address parameters to ignore', ignored, 'One per line: two addresses that differ only in these are one page.'),
        checkboxRow('Follow links to other sites', config.followLinksToOtherSites === true, (on) => commit((draft) => {
          draft.followLinksToOtherSites = on;
        })),
        checkboxRow('AI tools can run it', isObject(config.mcp) && config.mcp.collect === true, (on) => commit((draft) => {
          draft.mcp = { ...(isObject(draft.mcp) ? draft.mcp : {}), collect: on };
        }))),
      fieldset('Where records go',
        labelled('Output (JSON)', output, 'The list in this document its records are written to, and how a record updates one there.')),
    );
  });
}

/** An editor and a reader of the same block, one above the other: both redraw when the block changes. */
function stacked(editor: HvyPluginInstance, view: HvyPluginInstance): HvyPluginInstance {
  const element = document.createElement('div');
  element.className = 'hvy-web-editor-stack';
  element.append(editor.element, view.element);
  return {
    element,
    refresh: () => {
      editor.refresh?.();
      view.refresh?.();
    },
    unmount: () => {
      editor.unmount?.();
      view.unmount?.();
    },
  };
}

/** A web profile context in the editor: the profile by name, typed, for one this machine may not have. */
function profileContextEditor(ctx: HvyPluginContext): HvyPluginInstance {
  return configEditor(ctx, readProfileContextBlockConfig, 'hvy-web-context-editor', (root, { config, commit, problem }) => {
    const name = textInput('profile', String(config.profile ?? ''));
    name.placeholder = 'Chosen when the file is opened';
    name.addEventListener('change', () => commit((draft) => {
      draft.schemaVersion = WEB_AUTOMATION_SCHEMA_VERSION;
      draft.profile = name.value.trim() || undefined;
    }));
    root.append(problem, labelled('Browser profile name', name, 'Matched by name on each machine. Blank: whoever opens the file chooses one.'));
  });
}

const webApiReader: HvyPluginFactory = (ctx) => {
  // The editor edits the block's configuration; the reader shows the account and signs in.
  if (ctx.mode === 'editor') return webApiEditor(ctx);
  // A probe or sign-in failure is shown until the user acts again.
  let problem = '';
  const probing = new Set<string>();
  return reader(ctx, (root, lookup, sync) => {
    const result = readWebApiBlockConfig(ctx.block.schema.pluginConfig);
    if (!result.ok) {
      root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
      // A service whose published file could not be read: it can be fetched again.
      const origin = originOf(ctx.block.schema.pluginConfig.service);
      if (origin && publishedService(origin)?.status === 'failed') root.append(tryAgain(lookup, origin));
      return;
    }
    const capability = result.value.capability;
    // A published service's capability is known once its file is fetched (the document opening fetches it).
    if (!capability) {
      root.append(heading(new URL(result.value.service!.origin).host), status('Reading the service’s published permissions…'));
      return;
    }
    const showProblem = (message: string) => {
      problem = message;
      sync();
    };
    const inContext = Boolean(profileContextFor(ctx.rawDocument, ctx.block));
    // The approval, in the profile the document names: without one yet, the file's profile is chosen first. (A block in
    // a web profile context without one waits for it, with no Sign in.)
    const openApproval = (label: string, primary: boolean) => {
      const open = button(label, primary);
      open.addEventListener('click', () => {
        problem = '';
        const profile = lookup.automation.profileOf(capability.capabilityId);
        if (profile) openApprovalDialog(lookup, capability, profile, showProblem);
        else chooseFileProfile(ctx, lookup, () => openApprovalDialog(lookup, capability, lookup.automation.profileOf(capability.capabilityId)!, showProblem));
      });
      return open;
    };
    // With several browser profiles here, the file's profile can change from here; a context changes it itself.
    const changeProfile = (): HTMLButtonElement[] => {
      if (inContext || state.integrationRegistry.profiles.length <= 1) return [];
      const change = button('Change profile…');
      change.addEventListener('click', () => chooseFileProfile(ctx, lookup));
      return [change];
    };
    root.append(heading(capability.name));
    const profile = lookup.automation.profileOf(capability.capabilityId);
    const finish = () => {
      if (problem) root.append(paragraph(problem, 'hvy-web-error'));
    };
    // Inside a web profile context that has no profile here yet, the block waits for it.
    if (!profile && inContext) {
      root.append(status(WAITING_FOR_CONTEXT));
      finish();
      return;
    }
    if (!profile || lookup.automation.reviewWebApi(capability).reason !== 'authorized') {
      // Whether the profile is signed in there is not checked before the file may use the site.
      root.append(status(profile ? 'Not allowed in this file yet.' : 'No browser profile chosen yet.'), actions(openApproval(`Allow ${capability.name}…`, true)));
      finish();
      return;
    }
    // Without a sign-in there is no account to check: allowed is ready.
    if (!capability.session) {
      root.append(status(`Ready · ${profile.name}`), actions(...changeProfile()));
      finish();
      return;
    }
    const session = lookup.automation.getState().sessions.find((candidate) => candidate.origin === capabilityOrigin(capability) && candidate.profileId === profile.id);
    const key = `${capability.capabilityId}\0${profile.id}`;
    if (!session || session.status === 'unknown') {
      if (!probing.has(key)) {
        probing.add(key);
        lookup.automation.probeSession(capability).catch((error: unknown) => {
          problem = errorMessage(error);
        }).finally(sync);
        root.append(status('Checking your account…'));
        return;
      }
      // The check finished without an answer (the page did not load, or the site answered with an error, which the
      // session keeps): say why, and let the user check again.
      const failure = problem || session?.error;
      if (failure) {
        const again = button('Check again', true);
        again.addEventListener('click', () => {
          problem = '';
          probing.delete(key);
          sync();
        });
        root.append(status('Couldn’t check your account.'), paragraph(failure, 'hvy-web-error'), actions(again, ...changeProfile()));
        return;
      }
      root.append(status('Checking your account…'));
      return;
    }
    probing.delete(key);
    if (session.status === 'signed-in') {
      const signOut = button('Sign out');
      signOut.addEventListener('click', () => void lookup.automation.signOut(capability).finally(sync));
      root.append(status(`Signed in · ${profile.name}`), actions(signOut, ...changeProfile()));
    } else {
      const signIn = button(`Sign in to ${capability.name}`, true);
      signIn.addEventListener('click', () => {
        problem = '';
        void lookup.automation.beginSignIn(capability).catch((error: unknown) => showProblem(errorMessage(error)));
      });
      root.append(status(session.status === 'pending-login' ? 'Finish signing in in the browser window.' : 'Not signed in.'), actions(signIn, ...changeProfile()));
    }
    const message = problem || session.error;
    if (message) root.append(paragraph(message, 'hvy-web-error'));
  });
};

/** Why a run waits for a person, by the reason it records. */
const ATTENTION_REASONS: Record<string, string> = {
  'unexpected-page': 'A page doesn’t look as its site setup expects. It may want you to sign in or prove you’re human.',
  challenge: 'The site wants you to prove you’re human.',
  'sign-in-wall': 'The site wants you to sign in.',
  'page-not-ready': 'A page didn’t finish loading.',
};

const RUN_STATUS: Record<string, string> = {
  running: 'Collecting',
  'needs-attention': 'Needs your attention',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
};

/** An address short enough to scan: the host, and the path's last two parts when it is longer. */
function shortAddress(value: string): string {
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  const path = parts.length > 2 ? `/…/${parts.slice(-2).join('/')}` : url.pathname === '/' ? '' : url.pathname;
  return `${url.host}${path}${url.search}`;
}

/** What a start page is called: its first fixed value (a careers page's company), or its address. */
function pageName(collection: CollectionDefinition, page: StartPage): string {
  const named = collection.fields.find((field) => page.values?.[field.id]);
  return named ? page.values![named.id] : shortAddress(page.url);
}

function items(collection: CollectionDefinition): string {
  return `${collection.itemName?.trim() || 'item'}s`;
}

function setupName(site: CollectionSite): string {
  return `${site.name}${site.from ? ` (${site.from.name} v${site.from.version})` : ''}`;
}

/** What reads an address, in words: its site setup, or a hand-written pattern's name. Null when nothing does. */
function readsWith(collection: CollectionDefinition, url: string): string | null {
  const recognized = recognizeAddress(collection, url);
  return recognized ? (recognized.site ? setupName(recognized.site) : recognized.pattern.name) : null;
}

type CollectionPatch = Partial<Pick<CollectionDefinition, 'startPages' | 'sites' | 'patterns' | 'maxPages' | 'maxItems' | 'stopAtKnownPage'>>;

/** Why the block would refuse a change, checked over the whole configuration as the loader and lint do. */
function checkCollection(ctx: HvyPluginContext, patch: CollectionPatch): string[] {
  const checked = readCollectionBlockConfig({ ...ctx.block.schema.pluginConfig, ...patch });
  return checked.ok ? [] : checked.errors;
}

/** Writes a change into the block, after checking it. Returns why it was refused, if it was. */
function saveCollection(ctx: HvyPluginContext, patch: CollectionPatch): string[] {
  const problems = checkCollection(ctx, patch);
  if (!problems.length) ctx.setConfig(patch as unknown as JsonObject);
  return problems;
}

/** The block's collection as it is now: a dialog open for a while, or a setup, saves onto the latest. */
function currentCollection(ctx: HvyPluginContext, fallback: CollectionDefinition): CollectionDefinition {
  const current = readCollectionBlockConfig(ctx.block.schema.pluginConfig);
  return current.ok ? current.value.collection : fallback;
}

/** An explicit modal: a title, a body to fill, a start page for a refused change's reason, and its buttons' row. */
function openModal(title: string, className: string): { form: HTMLFormElement; body: HTMLElement; errors: HTMLElement; row: HTMLElement; close(): void } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  const form = document.createElement('form');
  form.className = `dialog ${className}`;
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  form.setAttribute('aria-label', title);
  const heading = document.createElement('h2');
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'hvy-web-dialog-body';
  const errors = paragraph('', 'hvy-web-error');
  errors.setAttribute('role', 'alert');
  const row = document.createElement('div');
  row.className = 'dialog-actions';
  form.append(heading, body, errors, row);
  backdrop.appendChild(form);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  // Clicking off the dialog closes it, as the app's own dialogs do: only a press that also started off it, so
  // selecting text in a field and releasing outside keeps it open.
  let pressedOff = false;
  backdrop.addEventListener('pointerdown', (event) => {
    pressedOff = event.target === backdrop;
  });
  backdrop.addEventListener('click', (event) => {
    if (pressedOff && event.target === backdrop) close();
    pressedOff = false;
  });
  return { form, body, errors, row, close };
}

function labelled(text: string, input: HTMLElement, hint?: string): HTMLLabelElement {
  const label = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = text;
  label.append(name, input);
  if (hint) label.append(paragraph(hint, 'hvy-web-page-hint'));
  return label;
}

function textInput(name: string, value = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'hvy-galaxy-input';
  input.name = name;
  input.value = value;
  return input;
}

/** Inputs for fixed values: what a start page's pages don't show, the same for every item from it. */
function valueInputs(fields: CollectionField[], values: Record<string, string> = {}): { element: HTMLElement; read(): Record<string, string> } {
  const inputs = fields.filter((field) => field.kind === 'text').map((field) => ({ field, input: textInput(`value-${field.id}`, values[field.id] ?? '') }));
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'hvy-web-page-values';
  const legend = document.createElement('legend');
  legend.textContent = 'Defaults';
  fieldset.append(legend, paragraph('Used when the page doesn’t show one.', 'hvy-web-page-hint'));
  for (const { field, input } of inputs) fieldset.append(labelled(field.label, input));
  fieldset.hidden = !inputs.length;
  return {
    element: fieldset,
    read: () => Object.fromEntries(inputs.flatMap(({ field, input }) => (input.value.trim() ? [[field.id, input.value.trim()]] : []))),
  };
}

function withPage(collection: CollectionDefinition, url: string, values: Record<string, string>): StartPage[] {
  return [...collection.startPages, { id: startPageId(collection, url), url, ...(Object.keys(values).length ? { values } : {}) }];
}

/** The last step of adding a start page set up just now: the fields its new setup doesn't read, then the start page. */
function openPageValuesDialog(url: string, fields: CollectionField[], save: (values: Record<string, string>) => string[]): void {
  const { form, body, errors, row, close } = openModal(`Add ${shortAddress(url)}`, 'hvy-web-page-dialog wide-dialog');
  const values = valueInputs(fields);
  body.append(values.element);
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const submit = button('Add', true);
  submit.type = 'submit';
  row.append(cancel, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problems = save(values.read());
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  form.querySelector('input')?.focus();
}

/**
 * Sets up a site by pointing at it, on an address. A new setup is named for the address. `finish` saves it (Done);
 * until then nothing is saved, and `check` shows what the block would refuse.
 */
function setUpSiteFor(ctx: HvyPluginContext, collection: CollectionDefinition, url: string, site: CollectionSite | null, finish: (setup: SiteSetup) => string[]): void {
  const setup = site ?? { id: newSiteId(collection, url), name: shortAddress(new URL('.', url).href) };
  setUpSite({
    collection,
    url,
    site: setup,
    patterns: site ? patternsOf(collection, site.id) : [],
    check: (patterns) => checkCollection(ctx, withSiteSetups(currentCollection(ctx, collection), [{ ...setup, patterns }])),
    finish: (patterns) => finish({ ...setup, patterns }),
  });
}

/** Adding a start page nothing reads: set its site up, then the fields the setup doesn't read, then the start page. Cancelling adds nothing. */
function addPageBySettingUp(ctx: HvyPluginContext, collection: CollectionDefinition, url: string): void {
  setUpSiteFor(ctx, collection, url, null, (setup) => {
    const now = currentCollection(ctx, collection);
    const withSetup = { ...now, ...withSiteSetups(now, [setup]) };
    const unread = fieldsNotRead(withSetup, setup.patterns).filter((field) => field.kind === 'text');
    if (!unread.length) return saveCollection(ctx, { ...withSiteSetups(now, [setup]), startPages: withPage(now, url, {}) });
    const problems = checkCollection(ctx, withSiteSetups(now, [setup]));
    if (problems.length) return problems;
    openPageValuesDialog(url, unread, (values) => {
      const latest = currentCollection(ctx, collection);
      return saveCollection(ctx, { ...withSiteSetups(latest, [setup]), startPages: withPage(latest, url, values) });
    });
    return [];
  });
}

function trustworthyAddress(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A pasted site setup, in a few lines: what it is, what it reads, where, and whether it updates one here. */
function setupPlanText(collection: CollectionDefinition, plan: SiteSetupPaste): HTMLElement {
  const { setup, replaces, pages } = plan;
  const labels = [...new Set(setup.patterns.flatMap((pattern) => pattern.fields.filter((field) => field.kind === 'text').map((field) => field.id)))]
    .map((id) => collection.fields.find((field) => field.id === id)?.label ?? id);
  const change = !replaces
    ? 'Not in this document yet.'
    : !replaces.from || !setup.from
      ? 'Replaces the one in this document.'
      : setup.from.version > replaces.from.version
        ? `Newer than the one in this document (v${replaces.from.version} to v${setup.from.version}).`
        : setup.from.version === replaces.from.version
          ? `Same version as the one in this document (v${replaces.from.version}); it is replaced.`
          : `Older than the one in this document (v${replaces.from.version}); it is replaced with v${setup.from.version}.`;
  const element = document.createElement('div');
  element.className = 'hvy-web-page-setup';
  element.append(
    paragraph(setupName(setup), 'hvy-web-page-name'),
    paragraph(pages.length
      ? `Adds ${pages.length === 1 ? 'the page' : 'the pages'} ${pages.map((page) => shortAddress(page.url)).join(', ')}`
      : setup.pages?.length ? 'Its pages are already here.' : 'Adds no pages.', 'hvy-web-page-hint'),
    paragraph(`Website: ${websitesOf(setup).join(', ')}`, 'hvy-web-page-hint'),
    paragraph(`Reads: ${labels.join(', ') || 'nothing yet'}`, 'hvy-web-page-hint'),
    paragraph(change, 'hvy-web-page-hint'),
  );
  return element;
}

/**
 * "Paste site setup": a site setup copied from a site (its Copy button) or another document, read from the clipboard
 * and reviewed before anything changes: what each setup reads, on which sites, whether it is new or replaces one here,
 * and whether this collection takes it (the check saving runs). Where the clipboard cannot be read directly, a paste
 * area takes ⌘V instead of a text box. Wrong or broken text adds nothing, and says why.
 */
function openPasteSetupDialog(ctx: HvyPluginContext, collection: CollectionDefinition): void {
  const { body, errors, row, close } = openModal('Paste a site setup', 'hvy-web-page-dialog wide-dialog');
  const review = document.createElement('div');
  review.className = 'hvy-web-page-result';
  review.setAttribute('role', 'status');
  // Where the clipboard cannot be read directly: a place to paste into, not a text box.
  const zone = document.createElement('div');
  zone.className = 'hvy-web-paste-zone';
  zone.tabIndex = 0;
  zone.setAttribute('role', 'button');
  zone.textContent = `Press ${/Mac/.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V'} here to paste the site setup.`;
  zone.hidden = true;
  body.append(review, zone);
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const again = button('Read clipboard again');
  const add = button('Add', true);
  row.append(cancel, again, add);
  let accept: (() => string[]) | null = null;

  const show = (text: string) => {
    review.replaceChildren();
    errors.textContent = '';
    accept = null;
    add.disabled = true;
    add.textContent = 'Add';
    let setups: SiteSetup[] | null;
    try {
      setups = readSiteSetupText(text);
    } catch (error) {
      review.append(paragraph(errorMessage(error), 'hvy-web-error'));
      return;
    }
    if (!setups) {
      review.append(paragraph(trustworthyAddress(text.trim())
        ? 'That’s a page’s address. Use Add a page for it.'
        : 'The clipboard doesn’t have a site setup. Copy one, then paste again.', 'hvy-web-page-hint'));
      return;
    }
    const now = currentCollection(ctx, collection);
    const plans = planSiteSetupPaste(now, setups);
    review.append(paragraph('From your clipboard:', 'hvy-web-page-hint'));
    for (const plan of plans) review.append(setupPlanText(now, plan));
    // Everything it holds, for anyone who wants to read it before adding it.
    const details = document.createElement('details');
    details.className = 'hvy-web-paste-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Show details';
    const raw = document.createElement('pre');
    raw.className = 'hvy-web-json';
    raw.textContent = JSON.stringify(setups, null, 2);
    details.append(summary, raw);
    review.append(details);
    // Checked as saving checks it: all of it is added, or none.
    const problems = checkCollection(ctx, withSiteSetups(now, setups));
    if (problems.length) {
      review.append(paragraph(`This collection can’t take it: ${problems.join(' ')}`, 'hvy-web-error'));
      return;
    }
    const pasted = setups;
    add.textContent = plans.every((plan) => plan.replaces && !plan.pages.length) ? 'Update' : 'Add';
    accept = () => saveCollection(ctx, withSiteSetups(currentCollection(ctx, collection), pasted));
    add.disabled = false;
  };
  zone.addEventListener('paste', (event) => {
    event.preventDefault();
    show(event.clipboardData?.getData('text/plain') ?? '');
  });
  const readClipboard = () => readSystemClipboardText().then(show, () => {
    // This host cannot read the clipboard directly: the paste area takes it.
    zone.hidden = false;
    again.textContent = 'Paste again';
    review.replaceChildren(paragraph('Copy a site setup, then paste it below.', 'hvy-web-page-hint'));
    zone.focus();
  });
  again.addEventListener('click', () => {
    if (zone.hidden) void readClipboard();
    else zone.focus();
  });
  add.addEventListener('click', () => {
    if (!accept) return;
    const problems = accept();
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  add.disabled = true;
  void readClipboard();
}

/**
 * Add a page: its address. An address a setup reads asks only for the fields that setup doesn't read; one nothing
 * reads goes on to setting its site up. Cancelling at any point adds nothing. Site setups come in through Paste site
 * setup.
 */
function openAddPageDialog(ctx: HvyPluginContext, collection: CollectionDefinition): void {
  const { form, body, errors, row, close } = openModal('Add a page', 'hvy-web-page-dialog wide-dialog');
  const input = textInput('address');
  input.placeholder = 'https://';
  input.autocomplete = 'off';
  const result = document.createElement('div');
  result.className = 'hvy-web-page-result';
  result.setAttribute('role', 'status');
  let values = valueInputs([]);
  body.append(labelled('Address', input, `Paste the address of a list of ${items(collection)}: a careers page, or a search on a job board.`), result, values.element);
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const submit = button('Add', true);
  submit.type = 'submit';
  row.append(cancel, submit);
  let action: (() => string[]) | null = null;

  const update = () => {
    errors.textContent = '';
    result.replaceChildren();
    action = null;
    submit.textContent = 'Add';
    const entered = input.value.trim();
    // A site setup pasted here belongs to Paste site setup, which reviews it.
    const isSetup = (() => {
      try {
        return readSiteSetupText(entered) !== null;
      } catch {
        return entered.includes('"hvy"');
      }
    })();
    const url = isSetup || !entered ? null : trustworthyAddress(entered);
    const now = currentCollection(ctx, collection);
    const duplicate = url !== null && now.startPages.some((page) => page.url === url);
    const known = url && !duplicate ? recognizeAddress(now, url) : null;
    const recognized = url && !duplicate ? readsWith(now, url) : null;
    const next = valueInputs(known ? fieldsNotRead(now, known.site ? patternsOf(now, known.site.id) : [known.pattern]) : []);
    values.element.replaceWith(next.element);
    values = next;
    if (isSetup) {
      result.append(paragraph('That’s a site setup. Use Paste site setup for it.', 'hvy-web-page-hint'));
    } else if (entered && !url) {
      result.append(paragraph('That isn’t an address.', 'hvy-web-page-hint'));
    } else if (duplicate) {
      result.append(paragraph('Already one of the pages.', 'hvy-web-page-hint'));
    } else if (url && recognized) {
      result.append(paragraph(`Reads with: ${recognized}`, 'hvy-web-page-hint'));
      action = () => saveCollection(ctx, { startPages: withPage(currentCollection(ctx, collection), url, values.read()) });
    } else if (url && canSetUpSites()) {
      result.append(paragraph(`This site isn’t set up yet. Next, pick an example of one of its ${items(now)}.`, 'hvy-web-page-hint'));
      submit.textContent = 'Set up this site';
      action = () => {
        close();
        addPageBySettingUp(ctx, now, url);
        return [];
      };
    } else if (url) {
      result.append(paragraph('This site isn’t set up yet, so runs will skip it.', 'hvy-web-page-hint'));
      action = () => saveCollection(ctx, { startPages: withPage(currentCollection(ctx, collection), url, {}) });
    }
    submit.disabled = !action;
  };
  input.addEventListener('input', update);
  update();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!action) return;
    const problems = action();
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  input.focus();
}

/** Copies a site setup as text, for pasting into another collection. */
function copySetup(collection: CollectionDefinition, siteId: string, control: HTMLButtonElement, errors: HTMLElement): void {
  const setup = siteSetupOf(collection, siteId);
  if (!setup) return;
  navigator.clipboard.writeText(siteSetupText([setup])).then(() => {
    control.textContent = 'Copied';
  }, (error: unknown) => {
    errors.textContent = `Couldn’t copy: ${errorMessage(error)}`;
  });
}

/**
 * A start page: its address and fixed values, and the site setup that reads it (set up again, copy, or remove). Saving
 * checks the whole block's configuration first, so a change that breaks a reference is refused here.
 */
function openPageDialog(ctx: HvyPluginContext, collection: CollectionDefinition, startPage: StartPage): void {
  const { form, body, errors, row, close } = openModal(pageName(collection, startPage), 'hvy-web-page-dialog wide-dialog');
  const address = textInput('url', startPage.url);
  address.type = 'url';
  address.required = true;
  const values = valueInputs(collection.fields, startPage.values);
  body.append(labelled('Address', address), values.element);
  const site = recognizeAddress(collection, startPage.url)?.site ?? null;
  const setupBox = document.createElement('fieldset');
  setupBox.className = 'hvy-web-page-values';
  const legend = document.createElement('legend');
  legend.textContent = 'Site setup';
  const reads = readsWith(collection, startPage.url);
  setupBox.append(legend, paragraph(reads ? `Reads with: ${reads}` : 'Not set up: runs skip this page.', 'hvy-web-page-hint'));
  const setupActions = actions();
  if (canSetUpSites() && (site || !reads)) {
    const again = button(site ? 'Set up again' : 'Set up this site');
    again.addEventListener('click', () => {
      close();
      setUpSiteFor(ctx, collection, startPage.url, site, (setup) => saveCollection(ctx, withSiteSetups(currentCollection(ctx, collection), [setup])));
    });
    setupActions.append(again);
  }
  if (site) {
    const copy = button('Copy site setup');
    copy.addEventListener('click', () => copySetup(currentCollection(ctx, collection), site.id, copy, errors));
    setupActions.append(copy);
  }
  if (setupActions.childElementCount) setupBox.append(setupActions);
  // This page's own limits; blank fields use the default limits.
  const limitsBox = document.createElement('fieldset');
  limitsBox.className = 'hvy-web-page-values';
  const limitsLegend = document.createElement('legend');
  limitsLegend.textContent = 'Limits';
  const limits = limitFields(collection, startPage, false);
  limitsBox.append(limitsLegend, paragraph('Leave blank to use the default limits.', 'hvy-web-page-hint'), ...limits.elements);
  body.append(setupBox, limitsBox);
  const removePage = button('Remove page');
  removePage.addEventListener('click', () => {
    // The page's site setup goes with it when it reads no other page here.
    const now = currentCollection(ctx, collection);
    const reader = recognizeAddress(now, startPage.url)?.site;
    const lastRead = reader && startPagesReadBy(now, reader.id).every((page) => page.id === startPage.id);
    const problems = saveCollection(ctx, {
      ...(lastRead ? withoutSiteSetup(now, reader.id) : {}),
      startPages: now.startPages.filter((page) => page.id !== startPage.id),
    });
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const submit = button('Confirm', true);
  submit.type = 'submit';
  row.append(removePage, cancel, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { maxPages: _maxPages, maxItems: _maxItems, stopAtKnownPage: _stopAtKnownPage, ...rest } = startPage;
    const next: StartPage = { ...rest, url: address.value.trim(), values: values.read(), ...limits.read() };
    if (!Object.keys(next.values!).length) delete next.values;
    const problems = saveCollection(ctx, { startPages: currentCollection(ctx, collection).startPages.map((page) => (page.id === startPage.id ? next : page)) });
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  address.focus();
}

/** A start page's part of a run, in a line: what it is doing while the run goes, and how it went afterwards. */
function pageProgressText(progress: StartPageProgress, items: string, needsYou: boolean): string {
  const listed = `${progress.found} found, ${progress.known} already listed`;
  // The start page the run is on when it waits for the user: the card below, and the toolbar, say why.
  if (needsYou && (progress.status === 'reading' || progress.status === 'collecting')) return 'Needs you: a page here doesn’t look as expected. Show it from below.';
  switch (progress.status) {
    case 'waiting': return 'Waiting for its turn…';
    case 'reading': return progress.pages ? `Reading the list: page ${progress.pages}, ${listed}${progress.current ? ` · ${progress.current}` : ''}` : 'Opening the list…';
    case 'collecting': return `Collecting ${progress.read + 1} of ${progress.toCollect}${progress.current ? `: ${progress.current}` : ''} (${listed})`;
    case 'done': return `Last run: ${progress.collected} new, ${progress.known} already listed, ${progress.problems} with problems (${progress.found} ${items} on ${progress.pages} ${progress.pages === 1 ? 'page' : 'pages'})`;
    case 'stopped': return `Last run stopped after ${progress.read} of ${progress.toCollect}.`;
    case 'failed': return `Last run failed after ${progress.read} of ${progress.toCollect}.`;
  }
}

/**
 * A run's pages with problems, from its summary: each page (a start page by its name, an item by its title from the
 * list) and why it couldn't be read. Its address opens it in the browser window, signed in as the run was, to look at.
 */
function openProblemsDialog(lookup: DocumentAutomationLookup, collection: CollectionDefinition, run: CollectionRunState): void {
  const count = run.problemPages.length;
  const { body, row, close } = openModal(`${count} ${count === 1 ? 'page' : 'pages'} with problems`, 'hvy-web-page-dialog wide-dialog');
  body.append(paragraph('Pages the last run opened and couldn’t read. Open one to look at it.', 'hvy-web-page-hint'));
  const list = document.createElement('div');
  list.className = 'hvy-web-problems';
  for (const problem of run.problemPages) {
    const startPage = problem.kind === 'start-page' ? collection.startPages.find((page) => page.url === problem.url) : undefined;
    const entry = document.createElement('div');
    entry.className = 'hvy-web-problem';
    const address = document.createElement('a');
    address.className = 'hvy-web-automation-entry hvy-web-problem-link';
    address.href = problem.url;
    address.textContent = shortAddress(problem.url);
    address.addEventListener('click', (event) => {
      event.preventDefault();
      if (!lookup.automation.openLink(problem.url)) void openExternalUrl(problem.url);
    });
    entry.append(
      paragraph(startPage ? `Start page: ${pageName(collection, startPage)}` : problem.title ?? shortAddress(problem.url), 'hvy-web-automation-entry hvy-web-page-name'),
      address,
      paragraph(problem.problem, 'hvy-web-error'),
    );
    list.append(entry);
  }
  body.append(list);
  const done = button('Close', true);
  done.addEventListener('click', close);
  row.append(done);
  done.focus();
}

/** Each start page's progress in the latest run that included it. */
function latestPageProgress(runs: CollectionRunState[]): Record<string, { progress: StartPageProgress; problem: string | null; running: boolean; needsYou: boolean }> {
  const latest: Record<string, { progress: StartPageProgress; problem: string | null; running: boolean; needsYou: boolean }> = {};
  for (const run of runs) {
    for (const [pageId, progress] of Object.entries(run.startPages)) {
      latest[pageId] = { progress, problem: run.startPageProblems[pageId] ?? null, running: run.status === 'running' || run.status === 'needs-attention', needsYou: run.status === 'needs-attention' };
    }
  }
  return latest;
}

type Limit = 'maxPages' | 'maxItems';
type Limits = Partial<Record<Limit, number>> & { stopAtKnownPage?: boolean };

/**
 * How far a run goes at a page: list pages read, new items, and whether a list page of items already listed ends it.
 * For the default limits the numbers are required; for a page, a blank field (or "Default") uses the default, which
 * it shows.
 */
function limitFields(collection: CollectionDefinition, current: Limits, defaults: boolean): { elements: HTMLElement[]; read(): Limits } {
  const input = (limit: Limit) => {
    const field = textInput(limit, current[limit] === undefined ? '' : String(current[limit]));
    field.type = 'number';
    field.min = '1';
    // The bounds the block's configuration allows.
    field.max = String(LIMIT_BOUNDS[limit]);
    field.required = defaults;
    if (!defaults) field.placeholder = `${collection[limit]} (default)`;
    return field;
  };
  const pages = input('maxPages');
  const newItems = input('maxItems');
  const capitalized = `${items(collection).charAt(0).toUpperCase()}${items(collection).slice(1)}`;
  const stopText = `Stop at a list page of ${items(collection)} already listed`;
  const stopHint = 'For lists with the newest first: the pages after it are older.';
  const numbers = () => Object.fromEntries(([['maxPages', pages], ['maxItems', newItems]] as const)
    .flatMap(([limit, field]) => (field.value.trim() ? [[limit, Number(field.value)]] : [])));
  const elements = [
    labelled('Pages to read', pages, 'The page itself, then each Next.'),
    labelled(`New ${items(collection)} to read`, newItems, `${capitalized} already in the list don’t count.`),
  ];
  if (defaults) {
    const stop = document.createElement('input');
    stop.type = 'checkbox';
    stop.className = 'hvy-galaxy-input';
    stop.name = 'stopAtKnownPage';
    stop.checked = current.stopAtKnownPage === true;
    const stopLabel = document.createElement('label');
    stopLabel.className = 'checkbox-row';
    const stopName = document.createElement('span');
    stopName.textContent = stopText;
    stopLabel.append(stop, stopName);
    return { elements: [...elements, stopLabel, paragraph(stopHint, 'hvy-web-page-hint')], read: () => ({ ...numbers(), stopAtKnownPage: stop.checked }) };
  }
  // A page follows the default, or sets its own either way.
  const choice = document.createElement('select');
  choice.className = 'hvy-galaxy-select';
  choice.name = 'stopAtKnownPage';
  for (const [value, text] of [['', `Default (${collection.stopAtKnownPage ? 'stop' : 'keep going'})`], ['true', 'Stop'], ['false', 'Keep going']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = value === (current.stopAtKnownPage === undefined ? '' : String(current.stopAtKnownPage));
    choice.append(option);
  }
  const choiceLabel = document.createElement('label');
  const choiceName = document.createElement('span');
  choiceName.textContent = `At a list page of ${items(collection)} already listed`;
  choiceLabel.append(choiceName, choice, paragraph(stopHint, 'hvy-web-page-hint'));
  return {
    elements: [...elements, choiceLabel],
    read: () => ({ ...numbers(), ...(choice.value ? { stopAtKnownPage: choice.value === 'true' } : {}) }),
  };
}

/** A page's own limits, in words, or nothing when it uses the defaults. */
function ownLimitsText(collection: CollectionDefinition, page: StartPage): string | null {
  const parts = [
    ...(page.maxPages !== undefined ? [`${page.maxPages} ${page.maxPages === 1 ? 'page' : 'pages'}`] : []),
    ...(page.maxItems !== undefined ? [`${page.maxItems} new ${items(collection)}`] : []),
    ...(page.stopAtKnownPage !== undefined ? [page.stopAtKnownPage ? 'stops at a page already listed' : 'keeps going past pages already listed'] : []),
  ];
  return parts.length ? `Limits: ${parts.join(', ')}` : null;
}

/** "Default limits…": how far a run goes at each page that doesn't set its own, saved into the block. */
function openDefaultLimitsDialog(ctx: HvyPluginContext, collection: CollectionDefinition): void {
  const { form, body, errors, row, close } = openModal('Default limits', 'hvy-web-limits-dialog');
  const limits = limitFields(collection, collection, true);
  body.append(paragraph('For each page that doesn’t set its own.', 'hvy-web-page-hint'), ...limits.elements);
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const save = button('Confirm', true);
  save.type = 'submit';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problems = saveCollection(ctx, limits.read());
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  row.append(cancel, save);
  limits.elements[0].querySelector('input')?.focus();
}

/**
 * Where a run looks: the block's start pages, each with what reads it, whether collecting everything includes it, its
 * progress (or how its last run went), and collecting it alone; and adding another.
 */
function pagesSection(ctx: HvyPluginContext, collection: CollectionDefinition, runs: CollectionRunState[], collectPage: ((page: StartPage) => void) | null): HTMLElement {
  const progressByPage = latestPageProgress(runs);
  const busy = runs.some((run) => run.status === 'running' || run.status === 'needs-attention');
  const section = document.createElement('section');
  section.className = 'hvy-web-pages';
  section.setAttribute('aria-label', 'Pages to look at');
  const title = document.createElement('h3');
  title.className = 'hvy-web-pages-title';
  title.textContent = 'Pages to look at';
  section.append(title);
  if (!collection.startPages.length) section.append(paragraph('No pages yet.'));
  // Not ul/li: the reader styles those inside a document block as prose lists.
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  list.className = 'hvy-web-page-list';
  for (const page of collection.startPages) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.className = 'hvy-web-page';
    const recognized = recognizeAddress(collection, page.url);
    const reads = readsWith(collection, page.url);
    const summary = document.createElement('div');
    summary.className = 'hvy-web-page-summary';
    const name = pageName(collection, page);
    const latest = progressByPage[page.id];
    const include = document.createElement('input');
    include.type = 'checkbox';
    include.className = 'hvy-galaxy-input';
    include.checked = page.included !== false;
    include.addEventListener('change', () => {
      const latest = currentCollection(ctx, collection);
      saveCollection(ctx, { startPages: latest.startPages.map((candidate) => {
        if (candidate.id !== page.id) return candidate;
        const { included: _included, ...rest } = candidate;
        return include.checked ? rest : { ...rest, included: false as const };
      }) });
    });
    const includeLabel = document.createElement('label');
    includeLabel.className = 'checkbox-row hvy-web-page-include';
    const includeText = document.createElement('span');
    includeText.textContent = 'Include when collecting all';
    includeLabel.append(include, includeText);
    summary.append(
      paragraph(name, 'hvy-web-automation-entry hvy-web-page-name'),
      ...(name !== shortAddress(page.url) ? [paragraph(shortAddress(page.url), 'hvy-web-automation-entry hvy-web-page-hint')] : []),
      paragraph(reads ? `Reads with: ${reads}` : 'Not set up', 'hvy-web-page-hint'),
      ...(ownLimitsText(collection, page) ? [paragraph(ownLimitsText(collection, page)!, 'hvy-web-page-hint')] : []),
      ...(latest?.problem
        ? [paragraph(`Last run: couldn’t read this page. ${latest.problem}`, 'hvy-web-error')]
        : latest ? [paragraph(pageProgressText(latest.progress, items(collection), latest.needsYou), latest.needsYou ? 'hvy-web-page-progress hvy-web-page-needs-you' : latest.running ? 'hvy-web-page-progress' : 'hvy-web-page-hint')] : []),
      includeLabel,
    );
    const edit = button('Edit');
    edit.setAttribute('aria-label', `Edit ${name}`);
    edit.addEventListener('click', () => openPageDialog(ctx, collection, page));
    const controls = actions(edit);
    if (collectPage && reads) {
      const collect = button('Collect');
      collect.setAttribute('aria-label', `Collect ${name}`);
      collect.disabled = busy;
      collect.addEventListener('click', () => collectPage(page));
      controls.prepend(collect);
    }
    if (canSetUpSites() && (!reads || (latest?.problem && recognized?.site))) {
      const site = recognized?.site ?? null;
      const fix = button(site ? 'Fix' : 'Set up this site', true);
      fix.setAttribute('aria-label', `${site ? 'Fix' : 'Set up'} ${name}`);
      fix.addEventListener('click', () => setUpSiteFor(ctx, collection, page.url, site, (setup) => saveCollection(ctx, withSiteSetups(currentCollection(ctx, collection), [setup]))));
      controls.prepend(fix);
    }
    item.append(summary, controls);
    list.append(item);
  }
  if (collection.startPages.length) section.append(list);
  const add = button('+ Add a page');
  add.addEventListener('click', () => openAddPageDialog(ctx, collection));
  // A site setup copied from a site or another document: read from the clipboard and reviewed before it is added.
  const paste = button('Paste site setup');
  paste.addEventListener('click', () => openPasteSetupDialog(ctx, collection));
  // How far a run goes at each page that doesn't set its own limits.
  const limits = button('Default limits…');
  limits.addEventListener('click', () => openDefaultLimitsDialog(ctx, collection));
  section.append(
    paragraph(`Default limits: ${collection.maxPages} ${collection.maxPages === 1 ? 'page' : 'pages'} and ${collection.maxItems} new ${items(collection)} from each page${collection.stopAtKnownPage ? ', stopping at a list page already listed' : ''}.`, 'hvy-web-page-hint'),
    actions(add, paste, limits),
  );
  return section;
}

const collectionView: HvyPluginFactory = (ctx) => {
  // Why collecting one start page could not start, shown until the next try.
  let problem = '';
  return reader(ctx, (root, lookup, sync) => {
    const result = readCollectionBlockConfig(ctx.block.schema.pluginConfig);
    if (!result.ok) {
      root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
      return;
    }
    const collection = result.value.collection;
    const runs = lookup.automation.getState().runs.filter((candidate) => candidate.capabilityId === collection.capabilityId);
    const run = runs.at(-1);
    // One start page on its own, into the block's output, as collecting everything does.
    const sink = lookup.sink(collection.capabilityId);
    const collectPage = sink ? (page: StartPage) => {
      problem = '';
      try {
        lookup.automation.startCollection(collection, sink, [page.url]);
      } catch (error) {
        problem = errorMessage(error);
      }
      sync();
    } : null;
    root.append(heading(collection.name), ...profileLine(ctx, lookup, collection.capabilityId), pagesSection(ctx, collection, runs, collectPage));
    if (problem) root.append(paragraph(problem, 'hvy-web-error'));
    if (!run) return;
    const summary = status(`${RUN_STATUS[run.status]}: ${run.collected} new, ${run.skipped} already listed, `);
    if (run.problemPages.length) {
      // The pages it couldn't read, and why, in a dialog.
      const problems = document.createElement('button');
      problems.type = 'button';
      problems.className = 'hvy-web-link-button';
      problems.textContent = `${run.problems} with problems`;
      problems.addEventListener('click', () => openProblemsDialog(lookup, collection, run));
      summary.append(problems, '.');
    } else {
      summary.append(`${run.problems} with problems.`);
    }
    root.append(summary);
    if (run.status === 'running') {
      const stop = button('Stop');
      stop.addEventListener('click', () => lookup.automation.stopCollection(run.runId));
      root.append(actions(stop));
    } else if (run.status === 'needs-attention' && run.attention) {
      const show = button('Show', true);
      show.addEventListener('click', () => void lookup.automation.showAttention(run.runId));
      const resume = button('Resume');
      resume.addEventListener('click', () => lookup.automation.resumeAttention(run.runId));
      const stop = button('Stop');
      stop.addEventListener('click', () => lookup.automation.stopCollection(run.runId));
      root.append(needsYouNotice(
        lookup,
        `${run.runId}\0${run.attention.workerId}\0${run.attention.url}`,
        paragraph(`${ATTENTION_REASONS[run.attention.reason] ?? 'This page needs you.'} (${new URL(run.attention.url).host}) Show it, deal with it there, then Resume.`),
        actions(show, resume, stop),
      ));
    }
    if (run.error) root.append(paragraph(run.error, 'hvy-web-error'));
  });
};

const PAUSE_REASONS: Record<string, string> = {
  not_authenticated: 'Paused until you sign in again.',
  not_authorized: 'Paused until the service is allowed in this file.',
  no_profile: 'Paused until a browser profile is chosen for this file.',
  paused: 'Paused.',
};

const queueView: HvyPluginFactory = (ctx) => reader(ctx, (root, lookup, sync) => {
  const result = readQueueBlockConfig(ctx.block.schema.pluginConfig);
  if (!result.ok) {
    root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
    return;
  }
  const { queueId } = result.value;
  const queue = lookup.automation.getState().queues[queueId];
  if (!queue) return;
  const count = (statuses: QueueEntry['status'][]) => queue.entries.filter((entry) => statuses.includes(entry.status)).length;
  const waiting = count(['queued', 'waiting-retry']);
  const running = count(['running']);
  const failed = queue.entries.filter((entry) => entry.status === 'failed');
  // An idle queue is an implementation detail: it shows only while it has work, is paused, or has failures.
  root.hidden = !queue.paused && !queue.awaitingResume && waiting + running + failed.length === 0;
  if (root.hidden) return;
  root.append(heading(`Queue: ${queueId}`), status(`${waiting} waiting, ${running} running, ${count(['done'])} done, ${failed.length} failed.`));
  const resume = button('Resume', true);
  resume.addEventListener('click', () => {
    lookup.automation.resumeQueue(queueId);
    sync();
  });
  // Paused for something only the user can do (sign in, allow, or resume after reopening): a notice here, by the queue.
  if (queue.paused && (queue.pauseReason === 'not_authenticated' || queue.pauseReason === 'not_authorized' || queue.pauseReason === 'no_profile')) {
    root.append(needsYouNotice(lookup, `queue\0${queueId}\0${queue.pauseReason}`, paragraph(PAUSE_REASONS[queue.pauseReason] ?? `Paused (${queue.pauseReason}).`), actions(resume)));
  } else if (queue.paused) {
    root.append(paragraph(PAUSE_REASONS[queue.pauseReason ?? 'paused'] ?? `Paused (${queue.pauseReason}).`), actions(resume));
  } else if (queue.awaitingResume) {
    root.append(needsYouNotice(lookup, `queue\0${queueId}\0reopened`, paragraph('Work from before this file was opened waits until you resume it.'), actions(resume)));
  } else if (waiting + running > 0) {
    const pause = button('Pause');
    pause.addEventListener('click', () => {
      lookup.automation.pauseQueue(queueId);
      sync();
    });
    root.append(actions(pause));
  }
  // Every entry not finished, in the order they run, then those that failed: each can be run next (on its own, while
  // the queue is paused), cancelled, or retried.
  const listed = [
    ...queue.entries.filter((entry) => entry.status === 'running'),
    ...queue.entries.filter((entry) => entry.status === 'queued' || entry.status === 'waiting-retry'),
    ...failed,
  ];
  if (!listed.length) return;
  const held = queue.paused || queue.awaitingResume;
  // Not ul/li: the reader styles those inside a document block as prose lists.
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  list.className = 'hvy-web-queue-entries';
  for (const entry of listed) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.className = 'hvy-web-queue-entry';
    const act = (label: string, run: () => void, primary = false) => {
      const control = button(label, primary);
      control.setAttribute('aria-label', `${label}: ${entry.label ?? entry.key}`);
      control.addEventListener('click', () => {
        run();
        sync();
      });
      return control;
    };
    const controls = entry.status === 'running'
      ? []
      : entry.status === 'failed'
        ? [act('Retry', () => lookup.automation.retryQueueEntry(queueId, entry.key)), act('Dismiss', () => lookup.automation.cancelQueueEntry(queueId, entry.key))]
        : [act(held ? 'Run now' : 'Run next', () => lookup.automation.runQueueEntryNext(queueId, entry.key)), act('Cancel', () => lookup.automation.cancelQueueEntry(queueId, entry.key))];
    item.append(
      paragraph(entry.label ?? entry.key, 'hvy-web-automation-entry'),
      paragraph(QUEUE_ENTRY_STATUS[entry.status], 'hvy-web-page-hint'),
      ...(entry.lastError ? [paragraph(entry.lastError, entry.status === 'failed' ? 'hvy-web-error' : 'hvy-web-page-hint')] : []),
      ...(controls.length ? [actions(...controls)] : []),
    );
    list.append(item);
  }
  root.append(list);
});

/** Where an entry in the queue reader's list is. */
const QUEUE_ENTRY_STATUS: Record<QueueEntry['status'], string> = {
  running: 'Running…',
  queued: 'Waiting its turn',
  'waiting-retry': 'Waiting to try again',
  failed: 'Failed',
  done: 'Done',
  cancelled: 'Cancelled',
};

// In the editor, each block's configuration is edited above its reader (which already edits what it can: pages, limits,
// a profile); the Web API block's editor replaces its reader.
const collectionReader: HvyPluginFactory = (ctx) => (ctx.mode === 'editor' ? stacked(collectionSettingsEditor(ctx), collectionView(ctx)) : collectionView(ctx));
const queueReader: HvyPluginFactory = (ctx) => (ctx.mode === 'editor' ? stacked(queueEditor(ctx), queueView(ctx)) : queueView(ctx));
const profileContextReader: HvyPluginFactory = (ctx) => (ctx.mode === 'editor' ? stacked(profileContextEditor(ctx), profileContextView(ctx)) : profileContextView(ctx));

export const [webApiPlugin, webCollectionPlugin, queuePlugin, profileContextPlugin] = createWebAutomationPlugins({
  webApi: webApiReader,
  collection: collectionReader,
  queue: queueReader,
  profileContext: profileContextReader,
});
