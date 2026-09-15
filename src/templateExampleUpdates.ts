import { serializeDocumentHeaderYaml } from '../../heavy-file-format/src/serialization';
import { setAttachment } from '../../heavy-file-format/src/attachments';
import { getComponentDefsFromMeta, getSectionDefsFromMeta, getSectionTemplateKey } from '../../heavy-file-format/src/component-defs';
import { cloneReusableBlockFromMeta, cloneReusableSection, getReusableTemplate } from '../../heavy-file-format/src/document-factory';
import { visitBlocks } from '../../heavy-file-format/src/section-ops';
import type { VisualDocument } from './hvy';

/** Apply the same reusable-instance replacement used by the reference editor. */
export function updateExampleDefinitions(example: VisualDocument, template: VisualDocument): void {
  const oldComponents = getComponentDefsFromMeta(example.meta);
  const oldSections = getSectionDefsFromMeta(example.meta);
  const changed = (key: 'component_defs' | 'section_defs', before: unknown, after: unknown): boolean =>
    serializeDocumentHeaderYaml({ ...example, meta: { [key]: before ? [before] : [] } } as VisualDocument)
      !== serializeDocumentHeaderYaml({ ...example, meta: { [key]: [after] } } as VisualDocument);
  const changedComponents = new Set(getComponentDefsFromMeta(template.meta)
    .filter((definition) => changed('component_defs', oldComponents.find((old) => old.name === definition.name), definition))
    .map((definition) => definition.name));
  const changedSections = new Set(getSectionDefsFromMeta(template.meta)
    .filter((definition) => changed('section_defs', oldSections.find((old) => getSectionTemplateKey(old) === getSectionTemplateKey(definition)), definition))
    .map(getSectionTemplateKey));
  for (const attachment of template.attachments) {
    setAttachment(example, attachment.id, structuredClone(attachment.meta), attachment.bytes.slice());
  }
  example.meta.component_defs = structuredClone(template.meta.component_defs ?? []);
  example.meta.section_defs = structuredClone(template.meta.section_defs ?? []);
  const sectionDefs = getSectionDefsFromMeta(example.meta);
  const updateSections = (sections: VisualDocument['sections']): void => {
    for (const section of sections) {
      const definition = sectionDefs.find((candidate) => getSectionTemplateKey(candidate) === section.templateKey);
      if (definition && changedSections.has(getSectionTemplateKey(definition))) {
        const replacement = cloneReusableSection(definition.template, section.level, example.meta);
        Object.assign(section, replacement, { key: section.key, customId: section.customId, templateKey: section.templateKey });
      } else {
        updateSections(section.children);
      }
    }
  };
  updateSections(example.sections);
  const componentDefs = getComponentDefsFromMeta(example.meta);
  visitBlocks(example.sections, (block) => {
    const definition = componentDefs.find((candidate) => candidate.name === block.schema.component);
    if (!definition || !changedComponents.has(definition.name)) return;
    const replacement = cloneReusableBlockFromMeta(getReusableTemplate(definition), example.meta);
    block.text = replacement.text;
    block.schema = replacement.schema;
    block.schema.component = definition.name;
  });
}
