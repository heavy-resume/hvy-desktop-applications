import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { executeHvyCliCommandSync, writeHvyVirtualFileSync } from '../../../heavy-file-format/src/cli-core';
import { getComponentDefsFromMeta } from '../../../heavy-file-format/src/component-definition-helpers';
import { extractReusableTemplateVariablesFromDefinition } from '../../../heavy-file-format/src/reusable-template-values';
import { findSortValueAnnotations, formatSortValueAnnotation, replaceSortValueAnnotations } from '../../../heavy-file-format/src/sort-values';
import { parseFormSpec, serializeFormSpec } from '../../../heavy-file-format/src/plugins/form';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import type { DocumentItem, DocumentItemStore } from './recordSink';

/**
 * Where one item field lives inside an item, relative to the item's directory.
 * The same relative paths exist in the reusable template's `schema/`.
 */
/**
 * Where a field's value comes from, when not from the record's values: `collected` is when the item was found, as a
 * readable local date and time ("October 24, 2026 at 10:15 PDT") a datetime sort key can read.
 */
export type ItemFieldSource = 'collected';

export type ItemFieldBinding =
  | { kind: 'text'; path: string; source?: ItemFieldSource }
  | {
      kind: 'cell';
      /** A table's `tableRows.json`. */
      path: string;
      row: number;
      column: number;
      /** Wraps the value in a sort or group annotation so the component-list can sort or group by it. */
      annotation?: { kind: 'sort' | 'group'; key: string };
      /** Renders the cell as a Markdown link to the URL held in this field. */
      linkTo?: string;
    }
  | {
      /**
       * The body of the sort or group annotation with this key in a text file: a value within a line of text, such as
       * a card's summary "Title · Company · Location". The value replaces the annotation's body, and the list sorts or
       * groups by it. The template's text holds the annotations collection fills; a line the document's scripts write
       * whole (a status line) may add its annotations later, and is read the same way.
       */
      kind: 'annotated';
      path: string;
      annotation: { kind: 'sort' | 'group'; key: string };
      /** Renders the value as a Markdown link to the URL held in this field. */
      linkTo?: string;
      source?: ItemFieldSource;
    }
  | {
      /**
       * The value of a form's field: the field with this label in a form block inside the item (its `plugin.txt`). A
       * hidden field tells the form's script which item it is in, such as its job's address.
       */
      kind: 'form-field';
      path: string;
      label: string;
    };

export interface CliItemStoreConfig {
  /** The component-list that holds the items, e.g. /body/jobs/job-list. */
  listPath: string;
  /** The reusable template new items are created from. */
  componentName: string;
  /** Item field name → where its value lives inside an item. */
  fields: Record<string, ItemFieldBinding>;
  /** A text file inside the item holding the record's identity and provenance as JSON. */
  recordPath: string;
}

interface StoredRecord {
  key: string;
  url: string;
  state: DocumentItem['state'];
  problem?: string;
  provenance: DocumentItem['provenance'];
}

const ANNOTATION = /^<!--hvy:(sort|group)-value (\{.*?\})-->([\s\S]*)<!--\/hvy:\1-value-->$/;
const LINK = /^\[([\s\S]*)\]\((.*)\)$/;

export function itemComponentId(key: string): string {
  return `item-${bytesToHex(sha256(new TextEncoder().encode(key))).slice(0, 16)}`;
}

function cat(document: VisualDocument, path: string): string | null {
  try {
    return executeHvyCliCommandSync(document, `cat ${path}`).output.replace(/\n$/, '');
  } catch {
    return null;
  }
}

function write(document: VisualDocument, path: string, content: string): void {
  writeHvyVirtualFileSync(document, path, content);
}

/** A moment as a reader's local date and time: "October 24, 2026 at 10:15 PDT". */
export function readableTime(at: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { month: 'long', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
    .formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.month} ${parts.day}, ${parts.year} at ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

function encodeCell(binding: Extract<ItemFieldBinding, { kind: 'cell' }>, value: string, fields: Record<string, unknown>, url: string): string {
  let cell = escapeCell(value);
  if (binding.linkTo) {
    const target = binding.linkTo === 'url' ? url : String(fields[binding.linkTo] ?? '');
    cell = target ? `[${cell}](${target})` : cell;
  }
  if (binding.annotation) {
    cell = `<!--hvy:${binding.annotation.kind}-value ${JSON.stringify({ key: binding.annotation.key })}-->${cell}<!--/hvy:${binding.annotation.kind}-value-->`;
  }
  return cell;
}

/** The body of the sort or group annotation with this key in a text, as the reference implementation finds it. */
function readAnnotated(content: string, annotation: { kind: 'sort' | 'group'; key: string }): string | undefined {
  const found = findSortValueAnnotations(content, annotation.kind).find((candidate) => candidate.key === annotation.key);
  // A value within a line is one line; the saved text may wrap a long line inside it.
  return found ? decodeCell(found.text.replace(/\s+/g, ' ').trim()) : undefined;
}

/**
 * The text with this binding's annotation holding the value. A linked value is a Markdown link around the annotation,
 * not inside it: readers show an annotation's body as plain text, and the list sorts and groups by the bare value.
 */
function writeAnnotated(content: string, binding: Extract<ItemFieldBinding, { kind: 'annotated' }>, value: string, fields: Record<string, unknown>, url: string): string {
  const body = escapeCell(value);
  let written: string | null = null;
  const next = replaceSortValueAnnotations(content, (annotation) => {
    const replace = written === null && annotation.key === binding.annotation.key;
    const formatted = formatSortValueAnnotation(annotation.rawPayload, replace ? body : annotation.text, binding.annotation.kind);
    if (replace) written = formatted;
    return formatted;
  }, binding.annotation.kind);
  // A line may hold the value only once something sets it (a status line the document's scripts write whole): an empty
  // value with no start page in the line is nothing to write.
  if (written === null) {
    if (body) throw new Error(`${binding.path} has no ${binding.annotation.kind} value "${binding.annotation.key}" to fill.`);
    return content;
  }
  if (!binding.linkTo) return next;
  const target = binding.linkTo === 'url' ? url : String(fields[binding.linkTo] ?? '');
  const at = next.indexOf(written);
  const before = next.slice(0, at);
  const after = next.slice(at + (written as string).length);
  // Already linked: the address is replaced; otherwise the link is added (or left off without a value or address).
  const linked = before.endsWith('[') && /^\]\([^)]*\)/.exec(after);
  if (linked) return target && body ? `${before}${written}](${target})${after.slice(linked[0].length)}` : `${before.slice(0, -1)}${written}${after.slice(linked[0].length)}`;
  return target && body ? `${before}[${written}](${target})${after}` : next;
}

function decodeCell(cell: string): string {
  const annotated = ANNOTATION.exec(cell);
  const inner = annotated ? annotated[3] : cell;
  const link = LINK.exec(inner);
  return link ? link[1] : inner;
}

/**
 * A document item store over a component-list in an HVY document, written
 * and read through the reference implementation's CLI. Items are instances
 * of a reusable template; fields live where the bindings say.
 */
export function createCliItemStore(document: VisualDocument, config: CliItemStoreConfig): DocumentItemStore {
  const itemPath = (id: string) => `${config.listPath}/${id}`;

  function itemIds(): string[] {
    const order = cat(document, `${config.listPath}/children-order.json`);
    return order ? (JSON.parse(order) as string[]) : [];
  }

  function readField(id: string, binding: ItemFieldBinding): unknown {
    const content = cat(document, `${itemPath(id)}/${binding.path}`);
    if (content === null) return undefined;
    if (binding.kind === 'text') return content;
    if (binding.kind === 'annotated') return readAnnotated(content, binding.annotation);
    if (binding.kind === 'form-field') {
      const value = parseFormSpec(content).spec.fields.find((field) => field.label === binding.label)?.value;
      return typeof value === 'string' ? value : undefined;
    }
    const rows = JSON.parse(content) as Array<{ cells: string[] }>;
    const cell = rows[binding.row]?.cells[binding.column];
    return cell === undefined ? undefined : decodeCell(cell);
  }

  function writeField(id: string, binding: ItemFieldBinding, value: unknown, item: DocumentItem): void {
    const text = value === undefined || value === null ? '' : String(value);
    const path = `${itemPath(id)}/${binding.path}`;
    if (binding.kind === 'text') {
      write(document, path, text);
      return;
    }
    if (binding.kind === 'annotated') {
      write(document, path, writeAnnotated(cat(document, path) ?? '', binding, text, item.fields, item.url));
      return;
    }
    if (binding.kind === 'form-field') {
      const { spec } = parseFormSpec(cat(document, path) ?? '');
      write(document, path, serializeFormSpec({ ...spec, fields: spec.fields.map((field) => (field.label === binding.label ? { ...field, value: text } : field)) }));
      return;
    }
    const rows = JSON.parse(cat(document, path) ?? '[]') as Array<{ cells: string[] }>;
    while (rows.length <= binding.row) rows.push({ cells: [] });
    const cells = rows[binding.row].cells;
    while (cells.length <= binding.column) cells.push('');
    cells[binding.column] = encodeCell(binding, text, item.fields, item.url);
    write(document, path, JSON.stringify(rows));
  }

  function read(id: string): DocumentItem | null {
    const recordText = cat(document, `${itemPath(id)}/${config.recordPath}`);
    if (!recordText) return null;
    const record = JSON.parse(recordText) as StoredRecord;
    const fields = Object.fromEntries(Object.entries(config.fields).flatMap(([name, binding]) => {
      const value = readField(id, binding);
      return value === undefined || value === '' ? [] : [[name, value]];
    }));
    return {
      key: record.key,
      url: record.url,
      fields,
      provenance: record.provenance,
      state: record.state,
      ...(record.problem ? { problem: record.problem } : {}),
    };
  }

  function create(id: string): void {
    const definition = getComponentDefsFromMeta(document.meta).find((candidate) => candidate.name === config.componentName);
    if (!definition) throw new Error(`The document has no reusable component "${config.componentName}".`);
    // Values are written through the field bindings below, so tokens start empty and no value is ever shell-quoted.
    const variables = extractReusableTemplateVariablesFromDefinition(definition).map((variable) => variable.name);
    const template = variables.length ? ` --using-template '${JSON.stringify(Object.fromEntries(variables.map((name) => [name, ''])))}'` : '';
    executeHvyCliCommandSync(document, `hvy insert -1 ${config.componentName} ${config.listPath} --id ${id}${template}`);
  }

  return {
    get: (key) => {
      const id = itemComponentId(key);
      return itemIds().includes(id) ? read(id) : null;
    },
    list: () => itemIds().flatMap((id) => read(id) ?? []),
    put: (item) => {
      const id = itemComponentId(item.key);
      const existing = itemIds().includes(id) ? read(id) : null;
      if (!existing) create(id);
      for (const [name, binding] of Object.entries(config.fields)) {
        const sourced = 'source' in binding && binding.source === 'collected' ? readableTime(item.provenance.collectedAt) : undefined;
        // When an item was found is when it was first found: a later run does not move it.
        if (sourced !== undefined && existing?.fields[name]) continue;
        const value = sourced ?? (name === 'url' && item.fields.url === undefined ? item.url : item.fields[name]);
        if (existing && existing.fields[name] === value) continue;
        // A new item keeps what the template starts it with (a status line saying "Not evaluated") for fields it has no value for.
        if (!existing && (value === undefined || value === null)) continue;
        writeField(id, binding, value, item);
      }
      const record: StoredRecord = {
        key: item.key,
        url: item.url,
        state: item.state,
        provenance: item.provenance,
        ...(item.problem ? { problem: item.problem } : {}),
      };
      write(document, `${itemPath(id)}/${config.recordPath}`, JSON.stringify(record));
    },
  };
}

/** Problems that would stop a CLI item store from working on this document. */
export function validateCliItemStore(document: VisualDocument, config: CliItemStoreConfig): string[] {
  const errors: string[] = [];
  const list = cat(document, `${config.listPath}/component-list.json`);
  if (list === null) errors.push(`${config.listPath} is not a component-list.`);
  else if ((JSON.parse(list) as { componentListComponent?: string }).componentListComponent !== config.componentName) {
    errors.push(`${config.listPath} does not list "${config.componentName}" items.`);
  }
  const schema = `/templates/components/${encodeURIComponent(config.componentName)}/schema`;
  if (cat(document, `/templates/components/${encodeURIComponent(config.componentName)}/definition.json`) === null) {
    errors.push(`The document has no reusable component "${config.componentName}".`);
    return errors;
  }
  if (cat(document, `${schema}/${config.recordPath}`) === null) errors.push(`The template has no record file at ${config.recordPath}.`);
  for (const [name, binding] of Object.entries(config.fields)) {
    const content = cat(document, `${schema}/${binding.path}`);
    if (content === null) {
      errors.push(`Field "${name}" points at ${binding.path}, which the template does not have.`);
      continue;
    }
    const annotation = 'annotation' in binding ? binding.annotation : undefined;
    if (annotation) {
      const definition = getComponentDefsFromMeta(document.meta).find((candidate) => candidate.name === config.componentName);
      const defs = annotation.kind === 'sort' ? definition?.sortValueDefs : definition?.groupValueDefs;
      if (!defs?.[annotation.key]) errors.push(`Field "${name}" uses ${annotation.kind} key "${annotation.key}", which the template does not define.`);
    }
  }
  return errors;
}
