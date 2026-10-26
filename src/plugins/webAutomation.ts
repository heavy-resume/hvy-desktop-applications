import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type { HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
import { state } from '../state';
import { subscribeWebAutomation } from '../webAutomation/app';
import type { CollectionDefinition, CollectionField, CollectionRunState, CollectionSite, StartPageProgress, StartPage } from '../webAutomation/collection';
import type { AuthorizationReview } from '../webAutomation/authorization';
import { LIMIT_BOUNDS, readCollectionBlockConfig, readProfileContextBlockConfig, readQueueBlockConfig, readWebApiBlockConfig, WEB_AUTOMATION_SCHEMA_VERSION } from '../webAutomation/configs';
import { createWebAutomationPlugins, resolveDocumentAutomation } from '../webAutomation/documentAutomation';
import { errorMessage } from '../webAutomation/errors';
import { isIgnoredProfileContext, profileContextFor } from '../webAutomation/profileContexts';
import { documentProfileName, resolveProfile, withDocumentProfile, type BrowserProfile } from '../webAutomation/profiles';
import type { QueueEntry } from '../webAutomation/queue';
import type { DocumentAutomationLookup } from '../webAutomation/scripting';
import { canSetUpSites, setUpSite } from '../webAutomation/siteSetupOpener';
import {
  fieldsNotRead, newSiteId, patternsOf, startPagesReadBy, planSiteSetupPaste, readSiteSetupText, recognizeAddress, siteSetupOf, siteSetupText, websitesOf, withSiteSetups, withoutSiteSetup,
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
    ['What it can do', capability.endpoints.map((endpoint) => endpoint.name).join(', ')],
    ...(capability.readOrigins?.length ? [['Also reads files from', capability.readOrigins.map((origin) => new URL(origin).host).join(', ')] as [string, string]] : []),
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
const profileContextReader: HvyPluginFactory = (ctx) => reader(ctx, (root, lookup) => {
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

const webApiReader: HvyPluginFactory = (ctx) => {
  // A probe or sign-in failure is shown until the user acts again.
  let problem = '';
  const probing = new Set<string>();
  return reader(ctx, (root, lookup, sync) => {
    const result = readWebApiBlockConfig(ctx.block.schema.pluginConfig);
    if (!result.ok) {
      root.append(paragraph(result.errors.join(' '), 'hvy-web-error'));
      return;
    }
    const capability = result.value.capability;
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
  return { form, body, errors, row, close: () => backdrop.remove() };
}

/** An explicit confirmation modal; a refused change shows its reason in place. */
function openConfirmDialog(options: { title: string; message: string; confirm: string; onConfirm(): string[] }): void {
  const { body, errors, row, close } = openModal(options.title, 'hvy-web-confirm-dialog');
  body.append(paragraph(options.message));
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const confirm = button(options.confirm, true);
  confirm.addEventListener('click', () => {
    const problems = options.onConfirm();
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  row.append(cancel, confirm);
  cancel.focus();
}

function labelled(text: string, input: HTMLInputElement, hint?: string): HTMLLabelElement {
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

/** A new start page's id from its address, unique in the block. */
function startPageId(collection: CollectionDefinition, url: string): string {
  const parsed = new URL(url);
  const base = `${parsed.host}${parsed.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  const taken = new Set(collection.startPages.map((page) => page.id));
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
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
  const { setup, replaces } = plan;
  const labels = [...new Set(setup.patterns.flatMap((pattern) => pattern.fields.filter((field) => field.kind === 'text').map((field) => field.id)))]
    .map((id) => collection.fields.find((field) => field.id === id)?.label ?? id);
  const change = !replaces
    ? 'New here.'
    : !replaces.from || !setup.from
      ? 'Replaces the one here.'
      : setup.from.version > replaces.from.version
        ? `Updates the one here (v${replaces.from.version}).`
        : setup.from.version === replaces.from.version
          ? 'The one here is the same version; it is replaced.'
          : `The one here is newer (v${replaces.from.version}); it is replaced with this older one.`;
  const element = document.createElement('div');
  element.className = 'hvy-web-page-setup';
  element.append(
    paragraph(setupName(setup), 'hvy-web-page-name'),
    paragraph(`Reads ${labels.join(', ') || 'nothing yet'}, on ${websitesOf(setup).join(', ')}.`, 'hvy-web-page-hint'),
    paragraph(change, 'hvy-web-page-hint'),
  );
  return element;
}

/**
 * Add a page: an address, or a pasted site setup. An address a setup reads asks only for the fields that
 * setup doesn't read; one nothing reads goes on to setting its site up. Cancelling at any point adds nothing.
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
  body.append(labelled('Address', input, `Paste the address of a list of ${items(collection)}: a careers page, or a search on a job board. Or paste a site setup you copied.`), result, values.element);
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
    let setups: SiteSetup[] | null = null;
    try {
      setups = readSiteSetupText(entered);
    } catch (error) {
      result.append(paragraph(errorMessage(error), 'hvy-web-error'));
    }
    const url = setups || !entered ? null : trustworthyAddress(entered);
    const now = currentCollection(ctx, collection);
    const duplicate = url !== null && now.startPages.some((page) => page.url === url);
    const known = url && !duplicate ? recognizeAddress(now, url) : null;
    const recognized = url && !duplicate ? readsWith(now, url) : null;
    const next = valueInputs(known ? fieldsNotRead(now, known.site ? patternsOf(now, known.site.id) : [known.pattern]) : []);
    values.element.replaceWith(next.element);
    values = next;
    if (setups) {
      const plans = planSiteSetupPaste(now, setups);
      for (const plan of plans) result.append(setupPlanText(now, plan));
      submit.textContent = plans.every((plan) => plan.replaces) ? 'Update' : setups.length === 1 ? 'Add site setup' : 'Add site setups';
      action = () => saveCollection(ctx, withSiteSetups(currentCollection(ctx, collection), setups));
    } else if (entered && !url) {
      if (!result.childElementCount) result.append(paragraph('That isn’t an address or a site setup.', 'hvy-web-page-hint'));
    } else if (duplicate) {
      result.append(paragraph('Already one of the pages.', 'hvy-web-page-hint'));
    } else if (url && recognized) {
      result.append(paragraph(`Reads with: ${recognized}`, 'hvy-web-page-hint'));
      action = () => saveCollection(ctx, { startPages: withPage(currentCollection(ctx, collection), url, values.read()) });
    } else if (url && canSetUpSites()) {
      result.append(paragraph(`This site isn’t set up yet. Next, point at where the ${items(now)} are on its page.`, 'hvy-web-page-hint'));
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
    const remove = button('Remove site setup');
    remove.addEventListener('click', () => {
      close();
      const others = startPagesReadBy(collection, site.id).filter((page) => page.id !== startPage.id);
      openConfirmDialog({
        title: 'Remove this site setup?',
        message: `${setupName(site)} is removed from this document. ${others.length ? `It also reads ${others.map((page) => pageName(collection, page)).join(', ')}. ` : ''}The pages stay, and runs skip them until a setup reads them.`,
        confirm: 'Remove',
        onConfirm: () => saveCollection(ctx, withoutSiteSetup(currentCollection(ctx, collection), site.id)),
      });
    });
    setupActions.append(copy, remove);
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
    const problems = saveCollection(ctx, { startPages: currentCollection(ctx, collection).startPages.filter((page) => page.id !== startPage.id) });
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
        ? [paragraph('Last run: couldn’t read this page.', 'hvy-web-error')]
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
  // How far a run goes at each page that doesn't set its own limits.
  const limits = button('Default limits…');
  limits.addEventListener('click', () => openDefaultLimitsDialog(ctx, collection));
  section.append(
    paragraph(`Default limits: ${collection.maxPages} ${collection.maxPages === 1 ? 'page' : 'pages'} and ${collection.maxItems} new ${items(collection)} from each page${collection.stopAtKnownPage ? ', stopping at a list page already listed' : ''}.`, 'hvy-web-page-hint'),
    actions(add, limits),
  );
  return section;
}

const collectionReader: HvyPluginFactory = (ctx) => {
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
    const counts = `${run.collected} new, ${run.skipped} already listed, ${run.problems} with problems`;
    root.append(status(`${RUN_STATUS[run.status]}: ${counts}.`));
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

const queueReader: HvyPluginFactory = (ctx) => reader(ctx, (root, lookup, sync) => {
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

export const [webApiPlugin, webCollectionPlugin, queuePlugin, profileContextPlugin] = createWebAutomationPlugins({
  webApi: webApiReader,
  collection: collectionReader,
  queue: queueReader,
  profileContext: profileContextReader,
});
