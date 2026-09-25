import { applyTemplateContentPatch, diffTemplateContent } from './templateExampleContent';
import { setAttachment } from '../../heavy-file-format/src/attachments';
import { getComponentDefsFromMeta, getSectionDefsFromMeta, getSectionTemplateKey } from '../../heavy-file-format/src/component-defs';
import { createEmptyBlock } from '../../heavy-file-format/src/document-factory';
import { visitBlocks } from '../../heavy-file-format/src/section-ops';
import type { VisualDocument } from './hvy';

/** Diff stored definitions once, apply their changes to instances, then advance definitions. */
export function updateExampleDefinitions(example: VisualDocument, template: VisualDocument): void {
  const oldComponents = getComponentDefsFromMeta(example.meta);
  const oldSections = getSectionDefsFromMeta(example.meta);
  const components = structuredClone(getComponentDefsFromMeta(template.meta));
  const sections = structuredClone(getSectionDefsFromMeta(template.meta));
  const componentPatches = new Map(components.map((definition) => {
    const previous = oldComponents.find((old) => old.name === definition.name);
    return [definition.name, { componentName: definition.name, patch: diffTemplateContent(previous ? createEmptyBlock(previous.name, false, example.meta) : undefined, createEmptyBlock(definition.name, false, template.meta)) }];
  }));
  for (const previous of oldComponents) {
    if (componentPatches.has(previous.name)) continue;
    // Match the reference editor's removal behavior: detach the concrete block
    // to its base component while retaining its filled content.
    componentPatches.set(previous.name, { componentName: previous.baseType, patch: diffTemplateContent(
      { schema: { component: previous.name } }, { schema: { component: previous.baseType } },
    ) });
  }
  const sectionPatches = new Map(sections.map((definition) => [getSectionTemplateKey(definition),
    diffTemplateContent(oldSections.find((old) => getSectionTemplateKey(old) === getSectionTemplateKey(definition))?.template, definition.template),
  ]));
  for (const section of example.sections) {
    const patch = sectionPatches.get(section.templateKey ?? '');
    if (patch) {
      const updated = applyTemplateContentPatch(section, patch);
      for (const key of Object.keys(section)) {
        if (!(key in updated)) delete (section as unknown as Record<string, unknown>)[key];
      }
      Object.assign(section, updated, { key: section.key, customId: section.customId, templateKey: section.templateKey });
    }
    if (section.templateKey && !sectionPatches.has(section.templateKey)
      && oldSections.some((old) => getSectionTemplateKey(old) === section.templateKey)) delete section.templateKey;
  }
  visitBlocks(example.sections, (block) => {
    const name = block.schema.component;
    const change = componentPatches.get(name);
    if (!change?.patch) return;
    const updated = applyTemplateContentPatch(block, change.patch);
    for (const key of Object.keys(block)) {
      if (!(key in updated)) delete (block as unknown as Record<string, unknown>)[key];
    }
    Object.assign(block, updated, { id: block.id });
    block.schema.component = change.componentName;
  });
  for (const attachment of template.attachments) {
    setAttachment(example, attachment.id, structuredClone(attachment.meta), attachment.bytes.slice());
  }
  example.meta.component_defs = components;
  example.meta.section_defs = sections;
}
