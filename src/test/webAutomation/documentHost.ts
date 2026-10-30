import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction, runInThisContext } from 'node:vm';
import { visitBlocks } from '../../../../heavy-file-format/src/block-traversal';
import type { VisualBlock } from '../../../../heavy-file-format/src/editor/types';
import { FORM_PLUGIN_VERSION, parseFormSpec, type FormFieldValue } from '../../../../heavy-file-format/src/plugins/form';
import { createLiveState, reconcileLiveState, type LiveFormState } from '../../../../heavy-file-format/src/plugins/form-live-state/form-live-state';
import { resetPluginDocumentHookState, runPluginDocumentHooks } from '../../../../heavy-file-format/src/plugins/hooks';
import { FORM_PLUGIN_ID, registerHostPlugin } from '../../../../heavy-file-format/src/plugins/registry';
import { createBrythonMinimalVfsPlugin } from '../../../../heavy-file-format/src/plugins/scripting/brython-minimal-vfs-plugin';
import { applyBrythonSourcePatches } from '../../../../heavy-file-format/src/plugins/scripting/brython-source-patches';
import type { ScriptingFormApi } from '../../../../heavy-file-format/src/plugins/scripting/runtime';
import { scriptingPlugin } from '../../../../heavy-file-format/src/plugins/scripting/scripting';
import { runUserScript, type ScriptingRunResult } from '../../../../heavy-file-format/src/plugins/scripting/wrapper';
import { activateStateRuntime, createStateRuntime, runWithStateRuntime, runWithStateRuntimeAsync, type StateRuntime } from '../../../../heavy-file-format/src/state';
import { setPluginAuthorizationCallbacks, type HvyPluginAuthorizationRequest } from '../../../../heavy-file-format/src/plugins/authorization/plugin-authorization-policy';
import type { VisualDocument } from '../../../../heavy-file-format/src/types';
import { serializeDocument } from '../../../../heavy-file-format/src/serialization';
import { getDatabaseChangeRevision } from '../../../../heavy-file-format/src/database-change-tracker';
import type { Clock } from '../../webAutomation/clock';
import { createTestState } from '../../../../heavy-file-format/tests/serialization-test-helpers';

const BRYTHON = fileURLToPath(new URL('../../../../heavy-file-format/node_modules/brython/brython.min.js', import.meta.url));
let brythonInstalled = false;
let pageStandInsInstalled = false;

/**
 * The few page globals the reference implementation touches outside rendering
 * (loading its UI bundle, Brython, the scripting wrapper): `window` is the Node
 * global, and `document` only creates inert elements that carry text.
 */
export function installPageStandIns(): void {
  if (pageStandInsInstalled) return;
  pageStandInsInstalled = true;
  const global = globalThis as Record<string, unknown>;
  const element = () => ({ getAttribute: () => null, setAttribute: () => undefined, dispatchEvent: () => true });
  global.window = globalThis;
  global.self = globalThis;
  global.addEventListener = () => undefined;
  global.document = { dispatchEvent: () => true, createElement: element };
}

/**
 * Loads the reference implementation's Python runtime (Brython) into Node, so
 * its own loadBrython() and runUserScript() run unchanged. Each stand-in
 * replaces one thing a page would provide.
 */
export function installBrythonForNode(): void {
  if (brythonInstalled) return;
  brythonInstalled = true;
  // Brython 3.14 registers a DOMContentLoaded listener and reads `self` outside its Node checks.
  // It must load before the page stand-ins: a stub `document` misleads its Node checks.
  const global = globalThis as Record<string, unknown>;
  global.self = globalThis;
  global.addEventListener = () => undefined;
  // In Node, Brython loads as a CommonJS module and publishes global.__BRYTHON__. Its source is patched first, as the
  // reference loader does for a page.
  const module = { exports: {} };
  compileFunction(applyBrythonSourcePatches(readFileSync(BRYTHON, 'utf8')), ['exports', 'require', 'module', '__filename', '__dirname'], { filename: BRYTHON })(
    module.exports, createRequire(BRYTHON), module, BRYTHON, fileURLToPath(new URL('.', `file://${BRYTHON}`)),
  );
  // Generated code refers to the global $B, which a script tag would have defined.
  global.$B = global.__BRYTHON__;
  // Node mode removes browser.window, which the scripting wrapper imports. Restore it as a page build defines it.
  const brython = global.__BRYTHON__ as { imported: { browser: Record<string, unknown> }; jsobj2pyobj(value: unknown): unknown };
  brython.imported.browser.window = brython.jsobj2pyobj(globalThis);
  // The reference implementation's minimal module bundle, as its Vite plugin generates it.
  const vfsModule = createBrythonMinimalVfsPlugin().load('\0virtual:hvy-brython-minimal-vfs')!;
  runInThisContext(JSON.parse(vfsModule.replace(/^export default /, '').replace(/;$/, '')) as string, { filename: 'hvy-minimal-vfs.js' });
  installPageStandIns();
}

let scenarioClock: Clock | null = null;

/**
 * The app's wall clock follows the scenario's virtual clock, so time-based
 * behaviour in the reference implementation (the script render watchdog,
 * doc.time) sees scenario time rather than the milliseconds a test takes.
 */
function followClock(clock: Clock): void {
  if (!scenarioClock) {
    const RealDate = Date;
    const epoch = RealDate.now() - clock.now();
    const now = () => epoch + (scenarioClock ?? clock).now();
    class ScenarioDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now());
        else super(...(args as [string | number | Date]));
      }

      static now(): number {
        return now();
      }
    }
    globalThis.Date = ScenarioDate as DateConstructor;
  }
  scenarioClock = clock;
}

/** A form by its block id, or by its block. */
type FormRef = string | VisualBlock;

function findPluginBlock(document: VisualDocument, blockId: string, pluginId: string): VisualBlock {
  let found: VisualBlock | null = null;
  visitBlocks(document.sections, (block) => {
    if (block.schema.id === blockId && block.schema.plugin === pluginId) found = block;
  });
  if (!found) throw new Error(`The document has no ${pluginId} block "${blockId}".`);
  return found;
}

/** doc.form over a mounted form's live state, as the form plugin's buildFormApi provides it, without rendering. */
function createFormApi(live: LiveFormState): ScriptingFormApi {
  return {
    get_value: (label) => live.values[label],
    set_value: (label, value) => {
      live.values[label] = typeof value === 'boolean' ? value : String(value ?? '');
    },
    get_values: () => ({ ...live.values }),
    set_options: (label, next) => {
      live.options[label] = Array.isArray(next) ? next.map((option) => ({ label: String(option.label ?? ''), value: String(option.value ?? '') })) : [];
    },
    get_options: (label) => (live.options[label] ?? []).map((option) => ({ ...option })),
    set_error: (label, message) => {
      live.errors[label] = String(message ?? '');
    },
    clear_error: (label) => {
      delete live.errors[label];
    },
    set_submit_disabled: (disabled, reason) => {
      live.submit = { disabled: disabled === true, reason: disabled === true ? String(reason ?? '') : '' };
    },
    get_submit_disabled: () => live.submit.disabled,
  };
}

/**
 * Runs an HVY document headless the way the app runs it in the viewer: an
 * app state with the document open, the reference implementation's plugin
 * document hooks on load and after every render (the app mounts documents
 * with heavy-file-format's embed-full, whose renderApp ends with
 * runPluginDocumentHooks), its scripting plugin, and its Python runtime.
 * Form submits run the form's own submit script as the form plugin does;
 * that is the only UI stood in for.
 */
/**
 * The app state for one open document, in the viewer, as the app keeps it:
 * it holds the document's plugin authorizations, and the host's render loop.
 * `getAcceptance` and `onAcceptanceChanged` are the app's persistence for
 * plugin authorizations (as power-script acceptance is persisted).
 */
export function createDocumentState(document: VisualDocument, authorization: {
  getAcceptance(request: HvyPluginAuthorizationRequest): boolean;
  onAcceptanceChanged(request: HvyPluginAuthorizationRequest & { accepted: boolean }): void;
}): StateRuntime {
  const state = createTestState(document);
  state.currentView = 'viewer';
  const runtime = createStateRuntime(state);
  runtime.callbacks.refreshReaderPanels = () => undefined;
  setPluginAuthorizationCallbacks(authorization, runtime);
  activateStateRuntime(runtime);
  return runtime;
}

export function openDocumentHost(document: VisualDocument, options: { stateRuntime: StateRuntime; clock?: Clock }) {
  installBrythonForNode();
  if (options.clock) followClock(options.clock);
  registerHostPlugin(scriptingPlugin);
  resetPluginDocumentHookState();
  const runtime = options.stateRuntime;
  let renders = 0;
  // Hook runs a render started. A call made while one is running is skipped as nested and returns at once, so waiting
  // for the hooks means waiting for these.
  const hookRuns = new Set<Promise<unknown>>();
  // A script's edit runs the hooks itself, and the render waits for them (the scripting runtime's onMutationFlushed),
  // so it comes after the script's run has resolved. Each script run that edited the document waits here for it.
  const pendingRenders = new Set<Promise<void>>();
  let renderWaiters: Array<() => void> = [];
  const nextRender = () => new Promise<void>((resolve) => renderWaiters.push(resolve));
  runtime.callbacks.renderApp = () => {
    renders += 1;
    const waiters = renderWaiters;
    renderWaiters = [];
    for (const resolve of waiters) resolve();
    const run = runPluginDocumentHooks('unknown');
    hookRuns.add(run);
    void run.finally(() => hookRuns.delete(run));
  };
  activateStateRuntime(runtime);
  const loaded = runPluginDocumentHooks('load');
  // Each form's live state, by the form: its block id, or its block (a form in each item of a list shares one id).
  const forms = new Map<string | VisualBlock, LiveFormState>();

  return {
    runtime,
    get renders() {
      return renders;
    },

    /**
     * Resolves when the load hooks, the renders scripts' edits are waiting on, and any hook runs renders started, have
     * finished. It runs no hooks of its own.
     */
    async idle(): Promise<void> {
      await loaded;
      while (hookRuns.size || pendingRenders.size) await Promise.allSettled([...hookRuns, ...pendingRenders]);
    },

    /** The host renders after a change made outside a script, such as a record sink writing items. */
    render(): void {
      runWithStateRuntime(runtime, () => runtime.callbacks.renderApp());
    },

    /** The form appears on screen: its initial script runs, as the form plugin runs it once per document. */
    async mountForm(blockId: FormRef): Promise<ScriptingRunResult | null> {
      const { spec } = liveForm(blockId);
      return spec.initialScript ? runFormScript(blockId, spec.initialScript, 'initial', false) : null;
    },

    /**
     * The user fills in fields and submits: the submit script runs with doc.form over the form's live state. A disabled
     * submit button cannot be pressed, as the form plugin refuses it.
     */
    async submitForm(blockId: FormRef, values: Record<string, FormFieldValue> = {}): Promise<ScriptingRunResult> {
      const { spec, live } = liveForm(blockId);
      if (live.submit.disabled) throw new Error(`The form's submit is disabled: ${live.submit.reason}`);
      Object.assign(live.values, values);
      return runFormScript(blockId, spec.submitScript, 'submit', true);
    },

    /** The user changes one field, such as ticking a checkbox: the field's change script runs, as the form plugin runs it. */
    async changeField(blockId: FormRef, label: string, value: FormFieldValue): Promise<ScriptingRunResult | null> {
      const { spec, live } = liveForm(blockId);
      live.values[label] = value;
      const script = spec.fields.find((field) => field.label === label)?.triggers.change;
      return script ? runFormScript(blockId, script, `change:${label}`, true) : null;
    },

    /** What the form shows: field values, options, errors, and whether its submit is disabled (and why). */
    form(blockId: FormRef): LiveFormState {
      return structuredClone(liveForm(blockId).live);
    },
  };

  // The form's live state follows its definition in the document, as the form plugin reconciles it on each render.
  function liveForm(blockId: FormRef) {
    const block = typeof blockId === 'string' ? findPluginBlock(document, blockId, FORM_PLUGIN_ID) : blockId;
    const { spec } = parseFormSpec(block.text, block.schema.pluginConfig);
    const live = forms.get(blockId) ?? createLiveState(spec);
    forms.set(blockId, live);
    reconcileLiveState(live, spec);
    return { block, spec, live };
  }

  /**
   * Runs one of a form's named scripts with the options the form plugin's runFormScript uses. A submit or field change
   * is the user's (the form plugin passes the event's isTrusted), so the scripting loop watchdog starts afresh for it.
   */
  function runFormScript(blockId: FormRef, scriptName: string, reason: string, startedByUser: boolean): Promise<ScriptingRunResult> {
    const { block, spec, live } = liveForm(blockId);
    const before = documentSignature();
    const rendered = nextRender();
    const run = runWithStateRuntimeAsync(runtime, () => runUserScript({
      document,
      source: spec.scripts[scriptName] ?? '',
      componentId: `${block.schema.id}:${scriptName}:${reason}`,
      pluginVersion: String(block.schema.pluginConfig.version ?? FORM_PLUGIN_VERSION),
      maxLines: spec.scriptStepBudget,
      form: createFormApi(live),
      libraries: spec.scriptLibraries,
      startedByUser,
    }));
    return run.then((result) => {
      if (documentSignature() !== before) {
        pendingRenders.add(rendered);
        void rendered.then(() => pendingRenders.delete(rendered));
      }
      return result;
    });
  }

  function documentSignature(): string {
    return `${serializeDocument(document)}\u0000${getDatabaseChangeRevision(document)}`;
  }
}

export type DocumentHost = ReturnType<typeof openDocumentHost>;
