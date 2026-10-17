import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { visitBlocks } from '../../../../heavy-file-format/src/block-traversal';
import type { VisualBlock } from '../../../../heavy-file-format/src/editor/types';
import { FORM_PLUGIN_VERSION, parseFormSpec, type FormFieldValue } from '../../../../heavy-file-format/src/plugins/form';
import { createLiveState, reconcileLiveState, type LiveFormState } from '../../../../heavy-file-format/src/plugins/form-live-state/form-live-state';
import { resetPluginDocumentHookState, runPluginDocumentHooks } from '../../../../heavy-file-format/src/plugins/hooks';
import { FORM_PLUGIN_ID, registerHostPlugin } from '../../../../heavy-file-format/src/plugins/registry';
import { createBrythonMinimalVfsPlugin } from '../../../../heavy-file-format/src/plugins/scripting/brython-minimal-vfs-plugin';
import type { ScriptingFormApi } from '../../../../heavy-file-format/src/plugins/scripting/runtime';
import { scriptingPlugin } from '../../../../heavy-file-format/src/plugins/scripting/scripting';
import { runUserScript, type ScriptingRunResult } from '../../../../heavy-file-format/src/plugins/scripting/wrapper';
import { activateStateRuntime, createStateRuntime, runWithStateRuntime, runWithStateRuntimeAsync, type StateRuntime } from '../../../../heavy-file-format/src/state';
import { setPluginAuthorizationCallbacks, type HvyPluginAuthorizationRequest } from '../../../../heavy-file-format/src/plugins/authorization/plugin-authorization-policy';
import type { VisualDocument } from '../../../../heavy-file-format/src/types';
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
  // In Node, Brython loads as a CommonJS module and publishes global.__BRYTHON__.
  createRequire(BRYTHON)(BRYTHON);
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
  };
}

/**
 * Runs an HVY document headless the way the app runs it in the viewer: an
 * app state with the document open, the reference implementation's plugin
 * document hooks on load and after every render (the app's renderApp ends
 * with runPluginDocumentHooks), its scripting plugin, and its Python runtime.
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
  runtime.callbacks.renderApp = () => {
    renders += 1;
    void runPluginDocumentHooks('unknown');
  };
  activateStateRuntime(runtime);
  const loaded = runPluginDocumentHooks('load');
  const forms = new Map<string, LiveFormState>();

  return {
    runtime,
    get renders() {
      return renders;
    },

    /** Resolves when the load hooks, and any hook runs they caused, have finished. */
    async idle(): Promise<void> {
      await loaded;
      await runWithStateRuntimeAsync(runtime, () => runPluginDocumentHooks('unknown'));
    },

    /** The host renders after a change made outside a script, such as a record sink writing items. */
    render(): void {
      runWithStateRuntime(runtime, () => runtime.callbacks.renderApp());
    },

    /** The form appears on screen: its initial script runs, as the form plugin runs it once per document. */
    async mountForm(blockId: string): Promise<ScriptingRunResult | null> {
      const { spec } = liveForm(blockId);
      return spec.initialScript ? runFormScript(blockId, spec.initialScript, 'initial') : null;
    },

    /** The user fills in fields and submits: the submit script runs with doc.form over the form's live state. */
    submitForm(blockId: string, values: Record<string, FormFieldValue> = {}): Promise<ScriptingRunResult> {
      const { spec, live } = liveForm(blockId);
      Object.assign(live.values, values);
      return runFormScript(blockId, spec.submitScript, 'submit');
    },

    /** What the form shows: field values, options, and errors. */
    form(blockId: string): LiveFormState {
      return structuredClone(liveForm(blockId).live);
    },
  };

  // The form's live state follows its definition in the document, as the form plugin reconciles it on each render.
  function liveForm(blockId: string) {
    const block = findPluginBlock(document, blockId, FORM_PLUGIN_ID);
    const { spec } = parseFormSpec(block.text, block.schema.pluginConfig);
    const live = forms.get(blockId) ?? createLiveState(spec);
    forms.set(blockId, live);
    reconcileLiveState(live, spec);
    return { block, spec, live };
  }

  /** Runs one of a form's named scripts with the options the form plugin's runFormScript uses. */
  function runFormScript(blockId: string, scriptName: string, reason: string): Promise<ScriptingRunResult> {
    const { block, spec, live } = liveForm(blockId);
    return runWithStateRuntimeAsync(runtime, () => runUserScript({
      document,
      source: spec.scripts[scriptName] ?? '',
      componentId: `${blockId}:${scriptName}:${reason}`,
      pluginVersion: String(block.schema.pluginConfig.version ?? FORM_PLUGIN_VERSION),
      maxLines: spec.scriptStepBudget,
      form: createFormApi(live),
      libraries: spec.scriptLibraries,
    }));
  }
}

export type DocumentHost = ReturnType<typeof openDocumentHost>;
