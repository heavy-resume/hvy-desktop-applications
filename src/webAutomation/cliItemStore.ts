import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { executeHvyCliCommandSync, writeHvyVirtualFileSync } from '../../../heavy-file-format/src/cli-core';
import { getComponentDefsFromMeta } from '../../../heavy-file-format/src/component-definition-helpers';
import { extractReusableTemplateVariablesFromDefinition } from '../../../heavy-file-format/src/reusable-template-values';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import type { DocumentItem, DocumentItemStore } from './recordSink';

/**
 * Where one item field lives inside an item, relative to the item's directory.
 * The same relative paths exist in the reusable template's `schema/`.
 */
export type ItemFieldBinding =
  | { kind: 'text'; path: string }
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
        const value = name === 'url' && item.fields.url === undefined ? item.url : item.fields[name];
        if (existing && existing.fields[name] === value) continue;
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
    if (binding.kind === 'cell' && binding.annotation) {
      const definition = getComponentDefsFromMeta(document.meta).find((candidate) => candidate.name === config.componentName);
      const defs = binding.annotation.kind === 'sort' ? definition?.sortValueDefs : definition?.groupValueDefs;
      if (!defs?.[binding.annotation.key]) errors.push(`Field "${name}" uses ${binding.annotation.kind} key "${binding.annotation.key}", which the template does not define.`);
    }
  }
  return errors;
}
