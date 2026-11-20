import { registerHvyCliPluginCommands } from '../../../heavy-file-format/src/cli-core/plugin-command-registry';
import { findBlockForVirtualDirectory } from '../../../heavy-file-format/src/cli-core/virtual-file-system';
import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type { HvyPlugin, HvyPluginContext, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
import './filePicker.css';

/**
 * File picker: a button in the document that lets the user choose a file from their computer, read as text and handed
 * to the document's script (an import, such as a CSV export). A script registers for a picker with
 * doc.plugins.call("galaxy.file-picker", "on_file", {"pickerId": "...", "handler": fn}); its handler is given
 * {name, size, mediaType, text}. A document only ever sees a file the user chose, so the plugin needs no per-file
 * approval.
 */
export const FILE_PICKER_PLUGIN_ID = 'galaxy.file-picker';
export const DEFAULT_FILE_PICKER_MAX_BYTES = 50 * 1024 * 1024;

export interface FilePickerConfig {
  /** How scripts name it in on_file. */
  pickerId: string;
  /** The button's label. */
  label: string;
  /** What the file chooser offers: extensions (".csv") or media types ("text/csv"). Empty: any file. */
  accept: string[];
  /** The largest file read. */
  maxBytes: number;
  /** Several files at once, each handed to the handler in turn. */
  multiple: boolean;
}

export interface PickedFile {
  name: string;
  size: number;
  mediaType: string;
  text: string;
}

export function readFilePickerConfig(raw: unknown): FilePickerConfig {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const accept = Array.isArray(value.accept)
    ? value.accept.filter((item): item is string => typeof item === 'string')
    : typeof value.accept === 'string' ? value.accept.split(',') : [];
  const maxBytes = typeof value.maxBytes === 'number' && Number.isFinite(value.maxBytes) && value.maxBytes > 0 ? Math.floor(value.maxBytes) : DEFAULT_FILE_PICKER_MAX_BYTES;
  return {
    pickerId: typeof value.pickerId === 'string' ? value.pickerId.trim() : '',
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : 'Choose File',
    accept: accept.map((item) => item.trim()).filter(Boolean),
    maxBytes,
    multiple: value.multiple === true,
  };
}

type FileHandler = (file: Record<string, unknown>) => unknown;

/**
 * Each document's handlers, by picker. The document's load script registers again on each run, and the latest
 * registration is the one called.
 */
const handlers = new WeakMap<object, Map<string, FileHandler>>();

/** Hands a picked file to the handler the document's script registered for the picker. Says whether there was one. */
export function deliverPickedFile(document: object, pickerId: string, file: PickedFile): boolean {
  const handler = handlers.get(document)?.get(pickerId);
  if (!handler) return false;
  handler({ name: file.name, size: file.size, mediaType: file.mediaType, text: file.text });
  return true;
}

/** A chosen file, read as UTF-8 text, within the picker's size limit. */
export async function readPickedFile(file: File, config: FilePickerConfig): Promise<PickedFile> {
  if (file.size > config.maxBytes) throw new Error(`${file.name} is ${sizeText(file.size)}; the most this reads is ${sizeText(config.maxBytes)}.`);
  return { name: file.name, size: file.size, mediaType: file.type, text: await file.text() };
}

/**
 * The files chosen, each read and handed to the handler in turn (a call each, so each one's writes are its own). All
 * are read before any is handed over, so a file over the limit stops them all. Null when no script registered.
 */
export async function deliverFiles(document: object, config: FilePickerConfig, files: File[]): Promise<PickedFile[] | null> {
  const read = await Promise.all(files.map((file) => readPickedFile(file, config)));
  for (const picked of read) {
    if (!deliverPickedFile(document, config.pickerId, picked)) return null;
  }
  return read;
}

export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function create(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-file-picker';
  // What happened to the last file chosen, while the block is on screen.
  let said: { text: string; error: boolean } | null = null;

  const render = () => {
    const config = readFilePickerConfig(ctx.block.schema.pluginConfig);
    root.replaceChildren();
    if (ctx.mode === 'editor') root.append(settings(ctx, config));
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'hvy-file-picker-input';
    if (config.accept.length) input.accept = config.accept.join(',');
    input.multiple = config.multiple;
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'hvy-galaxy-button hvy-file-picker-button';
    choose.textContent = config.label;
    choose.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return;
      choose.disabled = true;
      void deliverFiles(ctx.rawDocument, config, files)
        .then((read) => {
          said = read === null
            ? { text: `Nothing in this file uses it yet: no script registered on_file for "${config.pickerId}".`, error: true }
            : { text: `Read ${read.map((picked) => `${picked.name} (${sizeText(picked.size)})`).join(', ')}.`, error: false };
        })
        .catch((caught: unknown) => {
          said = { text: caught instanceof Error ? caught.message : String(caught), error: true };
        })
        .finally(render);
    });
    root.append(choose, input);
    if (said) {
      const status = document.createElement('p');
      status.className = said.error ? 'hvy-file-picker-status hvy-file-picker-error' : 'hvy-file-picker-status';
      status.textContent = said.text;
      root.append(status);
    }
  };
  render();
  return { element: root, refresh: render };
}

/** In the editor: its id, label, and the file types offered. */
function settings(ctx: HvyPluginContext, config: FilePickerConfig): HTMLElement {
  const fields = document.createElement('div');
  fields.className = 'hvy-file-picker-settings';
  const field = (label: string, value: string, hint: string, apply: (value: string) => JsonObject) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'hvy-file-picker-field';
    const title = document.createElement('span');
    title.textContent = label;
    const input = document.createElement('input');
    input.className = 'hvy-galaxy-input';
    input.value = value;
    input.title = hint;
    input.addEventListener('change', () => ctx.setConfig(apply(input.value)));
    wrapper.append(title, input);
    fields.append(wrapper);
  };
  field('Id', config.pickerId, 'Scripts register on_file for this id.', (value) => ({ pickerId: value.trim() }));
  field('Label', config.label, 'The button\'s label.', (value) => ({ label: value.trim() }));
  field('Accept', config.accept.join(', '), 'Extensions or media types, comma-separated (.csv, application/json). Empty: any file.', (value) => ({ accept: value.split(',').map((item) => item.trim()).filter(Boolean) }));
  // Check to the left of its label.
  const several = document.createElement('label');
  several.className = 'hvy-file-picker-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = config.multiple;
  box.addEventListener('change', () => ctx.setConfig({ multiple: box.checked }));
  const text = document.createElement('span');
  text.textContent = 'Several files';
  several.append(box, text);
  fields.append(several);
  return fields;
}

export const filePickerPlugin: HvyPlugin = {
  id: FILE_PICKER_PLUGIN_ID,
  version: '0.1.0',
  hvyApiVersion: '0.1',
  displayName: 'File Picker',
  create,
  scripting: {
    methods: {
      on_file: (args, ctx) => {
        const pickerId = typeof args.pickerId === 'string' ? args.pickerId.trim() : '';
        if (!pickerId) throw new Error('on_file needs a pickerId.');
        if (typeof args.handler !== 'function') throw new Error('on_file needs a handler function.');
        const byPicker = handlers.get(ctx.rawDocument) ?? new Map<string, FileHandler>();
        byPicker.set(pickerId, args.handler as FileHandler);
        handlers.set(ctx.rawDocument, byPicker);
        return null;
      },
    },
  },
  aiHint: 'A button that lets the user choose a file from their computer. Register a handler with on_file({"pickerId", "handler"}); it is given {name, size, mediaType, text} (the file read as UTF-8).',
};

registerHvyCliPluginCommands({
  name: 'galaxy-file-picker',
  pluginId: FILE_PICKER_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-file-picker',
  componentHints: [
    'This plugin is a button that lets the user choose a file from their computer, read as UTF-8 text and handed to the document\'s script (an import). Its pluginConfig: "pickerId" (how scripts name it), "label" (the button\'s, default "Choose File"), "accept" (extensions or media types, such as [".csv"]; empty, any file), "maxBytes" (default 50 MB), and "multiple" (several files at once, each handed to the handler in turn).',
    'The load script registers a handler: doc.plugins.call("galaxy.file-picker", "on_file", {"pickerId": ..., "handler": fn}); fn is given {"name", "size", "mediaType", "text"} once the user picks a file. The handler is a callback, so its database writes are kept.',
    'The document must declare it in its scripting plugins. A large file is best parsed in SQL (its lines handed to SQLite as a JSON array): a script\'s steps are counted.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.file-picker', description: 'Create a file picker. Set pluginConfig.pickerId, and register on_file for it in the load script.' }],
  operationCommands: [],
  lintChecks: [(context) => {
    const block = findBlockForVirtualDirectory(context.document, context.path);
    if (!block) return [];
    return readFilePickerConfig(block.schema.pluginConfig).pickerId ? [] : [{ message: 'A file picker needs a pickerId for scripts to register on_file with.' }];
  }],
});
