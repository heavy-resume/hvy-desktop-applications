import { diffWordsWithSpace } from 'diff';

type ValueObject = Record<string, unknown>;
export interface DefinitionDiffOptions {
  identity(value: unknown): string | undefined;
  instantiate(value: unknown): unknown;
  ignoreProperty(value: ValueObject, key: string): boolean;
}
export type DefinitionPatch =
  | { kind: 'value'; value: unknown }
  | { kind: 'text'; before: string; after: string; edits: TextEdit[] }
  | { kind: 'object'; changes: Array<{ key: string; patch: DefinitionPatch | null; remove?: boolean }> }
  | { kind: 'array'; before: unknown[]; structureChanged: boolean; items: Array<{ oldIndex?: number; value: unknown; patch: DefinitionPatch | null }> };
interface TextEdit { start: number; end: number; text: string }
const object = (value: unknown): value is ValueObject => value !== null && typeof value === 'object' && !Array.isArray(value);

function equivalent(left: unknown, right: unknown, options: DefinitionDiffOptions): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equivalent(item, right[index], options));
  if (!object(left) || !object(right)) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => options.ignoreProperty(left, key) || options.ignoreProperty(right, key) || equivalent(left[key], right[key], options));
}

// Authored identities take precedence. For anonymous values, first align unchanged
// items, then pair the remaining items in order. No matching by editable labels.
function matchArray(before: unknown[], values: unknown[], options: DefinitionDiffOptions): Map<number, number> {
  const matches = new Map<number, number>();
  const used = new Set<number>();
  const match = (predicate: (left: unknown, right: unknown) => boolean): void => {
    before.forEach((item, index) => {
      if (matches.has(index)) return;
      const target = values.findIndex((value, target) => !used.has(target) && predicate(item, value));
      if (target >= 0) { matches.set(index, target); used.add(target); }
    });
  };
  match((left, right) => options.identity(left) !== undefined && options.identity(left) === options.identity(right));
  match((left, right) => !options.identity(left) && !options.identity(right) && equivalent(left, right, options));
  match((left, right) => !options.identity(left) && !options.identity(right));
  return matches;
}

export function diffDefinition(before: unknown, after: unknown, options: DefinitionDiffOptions): DefinitionPatch | null {
  if (equivalent(before, after, options)) return null;
  if (Array.isArray(before) && Array.isArray(after)) {
    const matches = matchArray(before, after, options);
    const oldByNew = new Map([...matches].map(([old, next]) => [next, old]));
    return { kind: 'array', before: structuredClone(before), structureChanged: before.length !== after.length || [...matches].some(([old, next]) => old !== next) || matches.size !== before.length, items: after.map((value, index) => {
      const oldIndex = oldByNew.get(index);
      return { oldIndex, value: structuredClone(value), patch: oldIndex === undefined ? null : diffDefinition(before[oldIndex], value, options) };
    }) };
  }
  if (object(before) && object(after)) {
    const changes: Extract<DefinitionPatch, {kind: 'object'}>['changes'] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (options.ignoreProperty(before, key) || options.ignoreProperty(after, key)) continue;
      if (!(key in after)) changes.push({ key, patch: null, remove: true });
      else if (!(key in before)) changes.push({ key, patch: { kind: 'value', value: structuredClone(after[key]) } });
      else {
        const patch = diffDefinition(before[key], after[key], options);
        if (patch) changes.push({ key, patch });
      }
    }
    return changes.length ? { kind: 'object', changes } : null;
  }
  if (typeof before === 'string' && typeof after === 'string' && before && after) {
    return { kind: 'text', before, after, edits: textEdits(before, after) };
  }
  return { kind: 'value', value: structuredClone(after) };
}

export function applyDefinitionPatch<T>(instance: T, patch: DefinitionPatch | null, options: DefinitionDiffOptions): T {
  if (!patch) return instance;
  if (patch.kind === 'value') return options.instantiate(patch.value) as T;
  if (patch.kind === 'text') return (typeof instance === 'string' ? applyTextEdits(instance, patch) : patch.after) as T;
  if (patch.kind === 'object') {
    const result: ValueObject = object(instance) ? { ...instance } : {};
    for (const change of patch.changes) {
      if (change.remove) delete result[change.key];
      else result[change.key] = applyDefinitionPatch(result[change.key], change.patch, options);
    }
    return result as T;
  }
  const values = Array.isArray(instance) ? instance : [];
  const matches = matchArray(patch.before, values, options);
  const inherited = new Map([...matches].map(([old, index]) => [index, old]));
  if (!patch.structureChanged) {
    return values.map((value, index) => {
      const old = inherited.get(index);
      return old === undefined ? value : applyDefinitionPatch(value, patch.items[old].patch, options);
    }) as T;
  }
  const surviving = new Set(patch.items.flatMap((item) => item.oldIndex === undefined ? [] : [item.oldIndex]));
  const extras = new Map<number, unknown[]>();
  let anchor = -1;
  values.forEach((value, index) => {
    const old = inherited.get(index);
    if (old !== undefined) {
      if (surviving.has(old)) anchor = old;
    } else {
      extras.set(anchor, [...(extras.get(anchor) ?? []), value]);
    }
  });
  const additions = new Map<unknown, unknown>();
  for (const item of patch.items) {
    if (item.oldIndex === undefined) {
      let existing: unknown;
      for (const bucket of extras.values()) {
        const index = bucket.findIndex((value) => options.identity(item.value)
          ? options.identity(item.value) === options.identity(value)
          : equivalent(value, item.value, options));
        if (index >= 0) { [existing] = bucket.splice(index, 1); break; }
      }
      additions.set(item, existing ?? options.instantiate(item.value));
    }
  }
  const result: unknown[] = [...(extras.get(-1) ?? [])];
  for (const item of patch.items) {
    if (item.oldIndex === undefined) result.push(additions.get(item));
    else {
      const index = matches.get(item.oldIndex);
      // Only existing instances receive property edits; a locally deleted item
      // is not recreated by editing its definition.
      if (index !== undefined) result.push(applyDefinitionPatch(values[index], item.patch, options));
      result.push(...(extras.get(item.oldIndex) ?? []));
    }
  }
  return result as T;
}

function textEdits(before: string, after: string): TextEdit[] {
  const edits: TextEdit[] = [];
  let position = 0;
  let current: TextEdit | undefined;
  for (const change of diffWordsWithSpace(before, after)) {
    if (!change.added && !change.removed) {
      current = undefined;
      position += change.value.length;
    } else {
      if (!current) { current = { start: position, end: position, text: '' }; edits.push(current); }
      if (change.removed) { position += change.value.length; current.end = position; }
      else current.text += change.value;
    }
  }
  return edits;
}

function applyTextEdits(instance: string, patch: Extract<DefinitionPatch, {kind: 'text'}>): string {
  if (instance === patch.before || instance === patch.after) return patch.after;
  const localEdits = textEdits(patch.before, instance);
  const mapPosition = (position: number, end: boolean): number => {
    let offset = 0;
    for (const edit of localEdits) {
      if (edit.end <= position) offset += edit.text.length - (edit.end - edit.start);
      else if (edit.start < position) return edit.start + offset + (end ? edit.text.length : 0);
      else break;
    }
    return position + offset;
  };
  let result = instance;
  for (const edit of [...patch.edits].reverse()) {
    if (localEdits.some((local) => local.start === edit.start && local.end === edit.end && local.text === edit.text)) continue;
    // An insertion inside a value replaced by the instance has no surviving
    // text anchor. Keep that filled value; other edits still apply normally.
    if (edit.start === edit.end && localEdits.some((local) => local.start < edit.start && local.end > edit.end)) continue;
    const start = mapPosition(edit.start, false);
    const end = mapPosition(edit.end, true);
    result = result.slice(0, start) + edit.text + result.slice(end);
  }
  return result;
}
