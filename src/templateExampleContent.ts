import { makeId } from '../../heavy-file-format/src/utils';
import type { VisualDocument } from './hvy';
import { applyDefinitionPatch, diffDefinition, type DefinitionDiffOptions } from './templateDefinitionDiff';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

// Runtime editor identities are regenerated on read. Authored HVY identities
// remain in the diff and are used to address concrete nodes across reordering.
export const templateContentDiffOptions: DefinitionDiffOptions = {
  instantiate(value) {
    const copy = structuredClone(value);
    const assignEditorIdentities = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(assignEditorIdentities); return; }
      if (!record(value)) return;
      if (record(value.schema) && 'text' in value) value.id = makeId('block');
      else if (Array.isArray(value.blocks) && Array.isArray(value.children)) value.key = makeId('section');
      else if (value.idGenerated === true && 'id' in value) value.id = makeId('griditem');
      Object.values(value).forEach(assignEditorIdentities);
    };
    assignEditorIdentities(copy);
    return copy;
  },
  identity(value) {
    if (!record(value)) return undefined;
    if (value.customId && !value.customIdGenerated) return `section:${value.customId}`;
    if (record(value.schema) && value.schema.id && !value.idGenerated) return `block:${value.schema.id}`;
    if (!value.schema && !value.blocks && value.id && !value.idGenerated) return `item:${value.id}`;
    return undefined;
  },
  ignoreProperty(value, key) {
    if (record(value.schema) && 'text' in value) return ['id', 'idGenerated', 'schemaMode'].includes(key);
    if (Array.isArray(value.blocks) && Array.isArray(value.children)) return ['key', 'customIdGenerated', 'idEditorOpen'].includes(key) || (key === 'customId' && value.customIdGenerated === true);
    return 'id' in value && (key === 'idGenerated' || (key === 'id' && value.idGenerated === true));
  },
};

export function diffTemplateContent(before: unknown, after: unknown) {
  return diffDefinition(before, after, templateContentDiffOptions);
}
export function applyTemplateContentPatch<T>(instance: T, patch: ReturnType<typeof diffTemplateContent>): T {
  return applyDefinitionPatch(instance, patch, templateContentDiffOptions);
}

interface ExampleTemplateSource {
  meta: VisualDocument['meta'];
  sections: VisualDocument['sections'];
}

function sourceContent(document: VisualDocument): ExampleTemplateSource {
  const { component_defs: _components, section_defs: _sections, template_example_source: _source, ...meta } = document.meta;
  return { meta, sections: document.sections };
}

export function rememberExampleTemplate(example: VisualDocument, template: VisualDocument): void {
  example.meta.template_example_source = structuredClone(sourceContent(template)) as unknown as VisualDocument['meta'][string];
}

export function updateExampleContent(example: VisualDocument, before: VisualDocument | null, after: VisualDocument): void {
  const previous = example.meta.template_example_source as unknown as ExampleTemplateSource | undefined;
  const baseline = previous ?? (before ? sourceContent(before) : undefined);
  if (baseline) {
    const patch = diffTemplateContent(baseline, sourceContent(after));
    const updated = applyTemplateContentPatch(sourceContent(example), patch);
    example.sections = updated.sections;
    example.meta = { ...updated.meta, component_defs: example.meta.component_defs, section_defs: example.meta.section_defs };
  }
  rememberExampleTemplate(example, after);
}
