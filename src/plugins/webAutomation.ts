import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type { HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
import { state } from '../state';
import { subscribeWebAutomation } from '../webAutomation/app';
import type { CollectionDefinition, CollectionField, CollectionRunState, CollectionSite, PlaceProgress, StartPage } from '../webAutomation/collection';
import type { AuthorizationReview } from '../webAutomation/authorization';
import { readCollectionBlockConfig, readQueueBlockConfig, readWebApiBlockConfig } from '../webAutomation/configs';
import { createWebAutomationPlugins, resolveDocumentAutomation } from '../webAutomation/documentAutomation';
import { errorMessage } from '../webAutomation/errors';
import { readWebAutomationBlocks } from '../webAutomation/documentBlocks';
import type { QueueEntry } from '../webAutomation/queue';
import type { DocumentAutomationLookup } from '../webAutomation/scripting';
import { canSetUpSites, setUpSite } from '../webAutomation/siteSetupOpener';
import {
  fieldsNotRead, newSiteId, patternsOf, placesReadBy, planSiteSetupPaste, readSiteSetupText, recognizeAddress, siteSetupOf, siteSetupText, websitesOf, withSiteSetups, withoutSiteSetup,
  type SiteSetup, type SiteSetupPaste,
} from '../webAutomation/siteSetups';
import { capabilityOrigin, type WebApiCapability } from '../webAutomation/webApi';
import { button, buildProfileControls, selectedProfile } from './webCapabilities';
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

/**
 * Allow this file to use a web API's site: which browser profile to use, and what this file does there. Allowing
 * records both and gives the document's collections without a profile the same one; a block with a sign-in then
 * signs in, if the profile is not signed in already. Explicit modal, as for Galaxy's other web capabilities; it asks
 * again when the profile or what the block does changes.
 */
function openApprovalDialog(ctx: HvyPluginContext, lookup: DocumentAutomationLookup, capability: WebApiCapability, onOutcome: (problem: string) => void): void {
  if (!state.document) return;
  const profiles = state.integrationRegistry.profiles;
  const current = selectedProfile(capability) ?? (profiles.length === 1 ? profiles[0] : null);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  const dialog = document.createElement('form');
  dialog.className = 'dialog hvy-web-authorization-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Use ${capability.name} in this file?`);
  const title = document.createElement('h2');
  title.textContent = `Use ${capability.name} in this file?`;
  const profileLabel = document.createElement('label');
  const profileName = document.createElement('span');
  profileName.textContent = 'Browser profile';
  const profileSelect = document.createElement('select');
  profileSelect.className = 'hvy-galaxy-select';
  profileSelect.name = 'profile';
  profileSelect.required = true;
  const choose = document.createElement('option');
  choose.value = '';
  choose.textContent = 'Choose a profile';
  profileSelect.append(choose, ...profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === current?.id;
    return option;
  }));
  profileLabel.append(profileName, profileSelect, paragraph(capability.session ? 'Your sign-in stays in this browser profile.' : 'Calls use this browser profile’s cookies.', 'hvy-web-place-hint'));
  const details = document.createElement('dl');
  const rows: Array<[string, string]> = [
    ['Document', state.document.source.name],
    // The page you are sent to, in full, so its address can be checked before signing in.
    capability.session ? ['Sign-in page', capability.session.loginUrl] : ['Website', capability.pageUrl],
    ['Calls', capability.endpoints.map((endpoint) => endpoint.name).join(', ')],
    ...(capability.readOrigins?.length ? [['Also reads from', capability.readOrigins.map((origin) => new URL(origin).host).join(', ')] as [string, string]] : []),
  ];
  for (const [term, description] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description;
    details.append(dt, dd);
  }
  // With no profile chosen for this file yet, it is a first use.
  const review = selectedProfile(capability) ? lookup.automation.reviewWebApi(capability) : { capabilityId: capability.capabilityId, reason: 'first-use' as const, changedCategories: [] };
  const reason = paragraph(reviewReason(review, capability.name), 'hvy-web-authorization-reason');
  const note = paragraph(`${capability.session ? 'Calls are made as your signed-in account.' : 'Calls are made in your browser profile.'} What this file sends and stores is in the document.`);
  const row = document.createElement('div');
  row.className = 'dialog-actions';
  const close = () => backdrop.remove();
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const allow = button('Allow', true);
  allow.type = 'submit';
  // Signing in follows only for a block with a sign-in, in a profile not known to be signed in there.
  const signedIn = (profileId: string) => lookup.automation.getState().sessions.some((session) => session.origin === capabilityOrigin(capability) && session.profileId === profileId && session.status === 'signed-in');
  const showProfile = () => {
    allow.disabled = !profileSelect.value;
    allow.textContent = capability.session && !signedIn(profileSelect.value) ? 'Allow and sign in' : 'Allow';
  };
  profileSelect.addEventListener('change', showProfile);
  showProfile();
  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    const profileId = profileSelect.value;
    if (!profileId) return;
    lookup.automation.bindProfile(capability.capabilityId, profileId);
    lookup.automation.authorizeWebApi(capability);
    // The document's collections run in the same profile unless they were given another.
    for (const { config } of readWebAutomationBlocks(ctx.rawDocument).collections) {
      if (!selectedProfile(config.collection)) lookup.automation.bindProfile(config.collection.capabilityId, profileId);
    }
    close();
    if (capability.session) signInTo(lookup, capability).catch((error: unknown) => onOutcome(errorMessage(error)));
    // Nothing follows: the reader shows the block as ready.
    else onOutcome('');
  });
  row.append(cancel, allow);
  dialog.append(title, profileLabel, details, reason, note, row);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  (profileSelect.value ? allow : profileSelect).focus();
}

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
    // One step: the modal takes the profile and the approval, then signs in if the block has a sign-in.
    const openApproval = (label: string, primary: boolean) => {
      const open = button(label, primary);
      open.addEventListener('click', () => {
        problem = '';
        openApprovalDialog(ctx, lookup, capability, showProblem);
      });
      return open;
    };
    root.append(heading(capability.name));
    const profile = selectedProfile(capability);
    const finish = () => {
      if (problem) root.append(paragraph(problem, 'hvy-web-error'));
    };
    if (!profile || lookup.automation.reviewWebApi(capability).reason !== 'authorized') {
      root.append(capability.session
        ? status('Not signed in.')
        : status('Not allowed in this file yet.'), actions(openApproval(capability.session ? `Sign in to ${capability.name}` : `Allow ${capability.name}`, true)));
      finish();
      return;
    }
    // Without a sign-in there is no account to check: allowed is ready.
    if (!capability.session) {
      root.append(status(`Ready · ${profile.name}`), actions(openApproval('Change profile…', false)));
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
      }
      root.append(status(problem || 'Checking your account…'));
      return;
    }
    probing.delete(key);
    const changeProfile = openApproval('Change profile…', false);
    if (session.status === 'signed-in') {
      const signOut = button('Sign out');
      signOut.addEventListener('click', () => void lookup.automation.signOut(capability).finally(sync));
      root.append(status(`Signed in · ${profile.name}`), actions(signOut, changeProfile));
    } else {
      const signIn = button(`Sign in to ${capability.name}`, true);
      signIn.addEventListener('click', () => {
        problem = '';
        void lookup.automation.beginSignIn(capability).catch((error: unknown) => showProblem(errorMessage(error)));
      });
      root.append(status(session.status === 'pending-login' ? 'Finish signing in in the browser window.' : 'Not signed in.'), actions(signIn, changeProfile));
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

/** What a place is called: its first fixed value (a careers page's company), or its address. */
function placeName(collection: CollectionDefinition, page: StartPage): string {
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

type CollectionPatch = Partial<Pick<CollectionDefinition, 'startPages' | 'sites' | 'patterns'>>;

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

/** An explicit modal: a title, a body to fill, a place for a refused change's reason, and its buttons' row. */
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
  if (hint) label.append(paragraph(hint, 'hvy-web-place-hint'));
  return label;
}

function textInput(name: string, value = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'hvy-galaxy-input';
  input.name = name;
  input.value = value;
  return input;
}

/** Inputs for fixed values: what a place's pages don't show, the same for every item from it. */
function valueInputs(collection: CollectionDefinition, fields: CollectionField[], values: Record<string, string> = {}): { element: HTMLElement; read(): Record<string, string> } {
  const inputs = fields.filter((field) => field.kind === 'text').map((field) => ({ field, input: textInput(`value-${field.id}`, values[field.id] ?? '') }));
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'hvy-web-place-values';
  const legend = document.createElement('legend');
  legend.textContent = `Same for every ${collection.itemName?.trim() || 'item'} from here (optional)`;
  fieldset.append(legend, paragraph('For what its pages don’t show. A value read from the page wins.', 'hvy-web-place-hint'));
  for (const { field, input } of inputs) fieldset.append(labelled(field.label, input));
  fieldset.hidden = !inputs.length;
  return {
    element: fieldset,
    read: () => Object.fromEntries(inputs.flatMap(({ field, input }) => (input.value.trim() ? [[field.id, input.value.trim()]] : []))),
  };
}

/** A new place's id from its address, unique in the block. */
function startPageId(collection: CollectionDefinition, url: string): string {
  const parsed = new URL(url);
  const base = `${parsed.host}${parsed.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'place';
  const taken = new Set(collection.startPages.map((page) => page.id));
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

function withPlace(collection: CollectionDefinition, url: string, values: Record<string, string>): StartPage[] {
  return [...collection.startPages, { id: startPageId(collection, url), url, ...(Object.keys(values).length ? { values } : {}) }];
}

/** The last step of adding a place set up just now: the fields its new setup doesn't read, then the place. */
function openPlaceValuesDialog(collection: CollectionDefinition, url: string, fields: CollectionField[], save: (values: Record<string, string>) => string[]): void {
  const { form, body, errors, row, close } = openModal(`Add ${shortAddress(url)}`, 'hvy-web-place-dialog');
  const values = valueInputs(collection, fields);
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

/** Adding a place nothing reads: set its site up, then the fields the setup doesn't read, then the place. Cancelling adds nothing. */
function addPlaceBySettingUp(ctx: HvyPluginContext, collection: CollectionDefinition, url: string): void {
  setUpSiteFor(ctx, collection, url, null, (setup) => {
    const now = currentCollection(ctx, collection);
    const withSetup = { ...now, ...withSiteSetups(now, [setup]) };
    const unread = fieldsNotRead(withSetup, setup.patterns).filter((field) => field.kind === 'text');
    if (!unread.length) return saveCollection(ctx, { ...withSiteSetups(now, [setup]), startPages: withPlace(now, url, {}) });
    const problems = checkCollection(ctx, withSiteSetups(now, [setup]));
    if (problems.length) return problems;
    openPlaceValuesDialog(withSetup, url, unread, (values) => {
      const latest = currentCollection(ctx, collection);
      return saveCollection(ctx, { ...withSiteSetups(latest, [setup]), startPages: withPlace(latest, url, values) });
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
  element.className = 'hvy-web-place-setup';
  element.append(
    paragraph(setupName(setup), 'hvy-web-place-name'),
    paragraph(`Reads ${labels.join(', ') || 'nothing yet'}, on ${websitesOf(setup).join(', ')}.`, 'hvy-web-place-hint'),
    paragraph(change, 'hvy-web-place-hint'),
  );
  return element;
}

/**
 * Add a place to look: an address, or a pasted site setup. An address a setup reads asks only for the fields that
 * setup doesn't read; one nothing reads goes on to setting its site up. Cancelling at any point adds nothing.
 */
function openAddPlaceDialog(ctx: HvyPluginContext, collection: CollectionDefinition): void {
  const { form, body, errors, row, close } = openModal('Add a place to look', 'hvy-web-place-dialog');
  const input = textInput('place');
  input.placeholder = 'https://';
  input.autocomplete = 'off';
  const result = document.createElement('div');
  result.className = 'hvy-web-place-result';
  result.setAttribute('role', 'status');
  let values = valueInputs(collection, []);
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
    const next = valueInputs(now, known ? fieldsNotRead(now, known.site ? patternsOf(now, known.site.id) : [known.pattern]) : []);
    values.element.replaceWith(next.element);
    values = next;
    if (setups) {
      const plans = planSiteSetupPaste(now, setups);
      for (const plan of plans) result.append(setupPlanText(now, plan));
      submit.textContent = plans.every((plan) => plan.replaces) ? 'Update' : setups.length === 1 ? 'Add site setup' : 'Add site setups';
      action = () => saveCollection(ctx, withSiteSetups(currentCollection(ctx, collection), setups));
    } else if (entered && !url) {
      if (!result.childElementCount) result.append(paragraph('That isn’t an address or a site setup.', 'hvy-web-place-hint'));
    } else if (duplicate) {
      result.append(paragraph('Already a place to look.', 'hvy-web-place-hint'));
    } else if (url && recognized) {
      result.append(paragraph(`Reads with: ${recognized}`, 'hvy-web-place-hint'));
      action = () => saveCollection(ctx, { startPages: withPlace(currentCollection(ctx, collection), url, values.read()) });
    } else if (url && canSetUpSites()) {
      result.append(paragraph(`This site isn’t set up yet. Next, point at where the ${items(now)} are on its page.`, 'hvy-web-place-hint'));
      submit.textContent = 'Set up this site';
      action = () => {
        close();
        addPlaceBySettingUp(ctx, now, url);
        return [];
      };
    } else if (url) {
      result.append(paragraph('This site isn’t set up yet, so runs will skip it.', 'hvy-web-place-hint'));
      action = () => saveCollection(ctx, { startPages: withPlace(currentCollection(ctx, collection), url, {}) });
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
 * A place: its address and fixed values, and the site setup that reads it (set up again, copy, or remove). Saving
 * checks the whole block's configuration first, so a change that breaks a reference is refused here.
 */
function openPlaceDialog(ctx: HvyPluginContext, collection: CollectionDefinition, place: StartPage): void {
  const { form, body, errors, row, close } = openModal(placeName(collection, place), 'hvy-web-place-dialog');
  const address = textInput('url', place.url);
  address.type = 'url';
  address.required = true;
  const values = valueInputs(collection, collection.fields, place.values);
  body.append(labelled('Address', address), values.element);
  const site = recognizeAddress(collection, place.url)?.site ?? null;
  const setupBox = document.createElement('fieldset');
  setupBox.className = 'hvy-web-place-values';
  const legend = document.createElement('legend');
  legend.textContent = 'Site setup';
  const reads = readsWith(collection, place.url);
  setupBox.append(legend, paragraph(reads ? `Reads with: ${reads}` : 'Not set up: runs skip this place.', 'hvy-web-place-hint'));
  const setupActions = actions();
  if (canSetUpSites() && (site || !reads)) {
    const again = button(site ? 'Set up again' : 'Set up this site');
    again.addEventListener('click', () => {
      close();
      setUpSiteFor(ctx, collection, place.url, site, (setup) => saveCollection(ctx, withSiteSetups(currentCollection(ctx, collection), [setup])));
    });
    setupActions.append(again);
  }
  if (site) {
    const copy = button('Copy site setup');
    copy.addEventListener('click', () => copySetup(currentCollection(ctx, collection), site.id, copy, errors));
    const remove = button('Remove site setup');
    remove.addEventListener('click', () => {
      close();
      const others = placesReadBy(collection, site.id).filter((page) => page.id !== place.id);
      openConfirmDialog({
        title: 'Remove this site setup?',
        message: `${setupName(site)} is removed from this document. ${others.length ? `It also reads ${others.map((page) => placeName(collection, page)).join(', ')}. ` : ''}Places stay, and runs skip them until a setup reads them.`,
        confirm: 'Remove',
        onConfirm: () => saveCollection(ctx, withoutSiteSetup(currentCollection(ctx, collection), site.id)),
      });
    });
    setupActions.append(copy, remove);
  }
  if (setupActions.childElementCount) setupBox.append(setupActions);
  body.append(setupBox);
  const removePlace = button('Remove place');
  removePlace.addEventListener('click', () => {
    const problems = saveCollection(ctx, { startPages: currentCollection(ctx, collection).startPages.filter((page) => page.id !== place.id) });
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  const submit = button('Save', true);
  submit.type = 'submit';
  row.append(removePlace, cancel, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next: StartPage = { ...place, url: address.value.trim(), values: values.read() };
    if (!Object.keys(next.values!).length) delete next.values;
    const problems = saveCollection(ctx, { startPages: currentCollection(ctx, collection).startPages.map((page) => (page.id === place.id ? next : page)) });
    if (problems.length) errors.textContent = problems.join(' ');
    else close();
  });
  address.focus();
}

/** A place's part of a run, in a line: what it is doing while the run goes, and how it went afterwards. */
function placeProgressText(progress: PlaceProgress, items: string, needsYou: boolean): string {
  const listed = `${progress.found} found, ${progress.known} already listed`;
  // The place the run is on when it waits for the user: the card below, and the toolbar, say why.
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

/** Each place's progress in the latest run that included it. */
function latestPlaceProgress(runs: CollectionRunState[]): Record<string, { progress: PlaceProgress; problem: string | null; running: boolean; needsYou: boolean }> {
  const latest: Record<string, { progress: PlaceProgress; problem: string | null; running: boolean; needsYou: boolean }> = {};
  for (const run of runs) {
    for (const [placeId, progress] of Object.entries(run.places)) {
      latest[placeId] = { progress, problem: run.startPageProblems[placeId] ?? null, running: run.status === 'running' || run.status === 'needs-attention', needsYou: run.status === 'needs-attention' };
    }
  }
  return latest;
}

/**
 * Where a run looks: the block's places, each with what reads it, whether collecting everything includes it, its
 * progress (or how its last run went), and collecting it alone; and adding another.
 */
function placesSection(ctx: HvyPluginContext, collection: CollectionDefinition, runs: CollectionRunState[], collectPlace: ((page: StartPage) => void) | null): HTMLElement {
  const places = latestPlaceProgress(runs);
  const busy = runs.some((run) => run.status === 'running' || run.status === 'needs-attention');
  const section = document.createElement('section');
  section.className = 'hvy-web-places';
  section.setAttribute('aria-label', 'Places to look');
  const title = document.createElement('h3');
  title.className = 'hvy-web-places-title';
  title.textContent = 'Places to look';
  section.append(title);
  if (!collection.startPages.length) section.append(paragraph('No places yet.'));
  // Not ul/li: the reader styles those inside a document block as prose lists.
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  list.className = 'hvy-web-place-list';
  for (const page of collection.startPages) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.className = 'hvy-web-place';
    const recognized = recognizeAddress(collection, page.url);
    const reads = readsWith(collection, page.url);
    const summary = document.createElement('div');
    summary.className = 'hvy-web-place-summary';
    const name = placeName(collection, page);
    const place = places[page.id];
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
    includeLabel.className = 'checkbox-row hvy-web-place-include';
    const includeText = document.createElement('span');
    includeText.textContent = 'Include when collecting all';
    includeLabel.append(include, includeText);
    summary.append(
      paragraph(name, 'hvy-web-automation-entry hvy-web-place-name'),
      ...(name !== shortAddress(page.url) ? [paragraph(shortAddress(page.url), 'hvy-web-automation-entry hvy-web-place-hint')] : []),
      paragraph(reads ? `Reads with: ${reads}` : 'Not set up', 'hvy-web-place-hint'),
      ...(place?.problem
        ? [paragraph('Last run: couldn’t read this page.', 'hvy-web-error')]
        : place ? [paragraph(placeProgressText(place.progress, items(collection), place.needsYou), place.needsYou ? 'hvy-web-place-progress hvy-web-place-needs-you' : place.running ? 'hvy-web-place-progress' : 'hvy-web-place-hint')] : []),
      includeLabel,
    );
    const edit = button('Edit');
    edit.setAttribute('aria-label', `Edit ${name}`);
    edit.addEventListener('click', () => openPlaceDialog(ctx, collection, page));
    const controls = actions(edit);
    if (collectPlace && reads) {
      const collect = button('Collect');
      collect.setAttribute('aria-label', `Collect ${name}`);
      collect.disabled = busy;
      collect.addEventListener('click', () => collectPlace(page));
      controls.prepend(collect);
    }
    if (canSetUpSites() && (!reads || (place?.problem && recognized?.site))) {
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
  const add = button('+ Add a place to look');
  add.addEventListener('click', () => openAddPlaceDialog(ctx, collection));
  section.append(actions(add));
  return section;
}

const collectionReader: HvyPluginFactory = (ctx) => {
  // Why collecting one place could not start, shown until the next try.
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
    // One place on its own, into the block's output, as collecting everything does.
    const sink = lookup.sink(collection.capabilityId);
    const collectPlace = sink ? (page: StartPage) => {
      problem = '';
      try {
        lookup.automation.startCollection(collection, sink, [page.url]);
      } catch (error) {
        problem = errorMessage(error);
      }
      sync();
    } : null;
    root.append(heading(collection.name), buildProfileControls(collection, sync), placesSection(ctx, collection, runs, collectPlace));
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
  if (queue.paused && (queue.pauseReason === 'not_authenticated' || queue.pauseReason === 'not_authorized')) {
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
  if (!failed.length) return;
  // Not ul/li: the reader styles those inside a document block as prose lists.
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  list.className = 'hvy-web-automation-failures';
  for (const entry of failed) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.className = 'hvy-web-automation-failure';
    const retry = button('Retry');
    retry.addEventListener('click', () => {
      lookup.automation.retryQueueEntry(queueId, entry.key);
      sync();
    });
    const cancel = button('Cancel');
    cancel.addEventListener('click', () => {
      lookup.automation.cancelQueueEntry(queueId, entry.key);
      sync();
    });
    item.append(paragraph(entry.key, 'hvy-web-automation-entry'), paragraph(entry.lastError ?? 'Failed.', 'hvy-web-error'), actions(retry, cancel));
    list.append(item);
  }
  root.append(list);
});

export const [webApiPlugin, webCollectionPlugin, queuePlugin] = createWebAutomationPlugins({
  webApi: webApiReader,
  collection: collectionReader,
  queue: queueReader,
});
