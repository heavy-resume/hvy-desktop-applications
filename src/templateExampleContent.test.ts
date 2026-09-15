import { describe, expect, it } from 'vitest';
import { createBlankDocument, createEmptyBlock, createEmptySection } from '../../heavy-file-format/src/document-factory';
import { deserializeDocumentBytes, serializeDocumentBytes } from '../../heavy-file-format/src/serialization';
import { updateExampleContent } from './templateExampleContent';
import { updateExampleDefinitions } from './templateExampleUpdates';

function fixture() {
  const before = createBlankDocument('.thvy');
  const section = createEmptySection(1);
  section.customId = 'profile';
  section.title = 'Profile';
  const label = createEmptyBlock('text');
  label.schema.id = 'heading';
  label.text = 'Your experience';
  const data = createEmptyBlock('text');
  data.schema.id = 'experience';
  data.text = 'Fill in experience';
  section.blocks = [label, data];
  before.sections = [section];
  const sample = structuredClone(before);
  sample.extension = '.hvy';
  sample.meta.title = 'Ada';
  sample.sections[0].blocks[1].text = 'Engineer at Acme, 2020–2026';
  return { before, sample, after: structuredClone(before) };
}

describe('ordinary template content', () => {
  it('updates headings, text, layout, and document defaults around filled real data', () => {
    const { before, sample, after } = fixture();
    after.sections[0].title = 'Work history';
    after.sections[0].css = 'color: navy;';
    after.sections[0].blocks[0].text = 'Professional experience';
    after.sections[0].blocks[1].schema.css = 'font-weight: bold;';
    after.meta.css = 'font-size: 12px;';
    updateExampleContent(sample, before, after);
    expect(sample.sections[0].title).toBe('Work history');
    expect(sample.sections[0].css).toBe('color: navy;');
    expect(sample.sections[0].blocks[0].text).toBe('Professional experience');
    expect(sample.sections[0].blocks[1].text).toBe('Engineer at Acme, 2020–2026');
    expect(sample.sections[0].blocks[1].schema.css).toBe('font-weight: bold;');
    expect(sample.meta.title).toBe('Ada');
    expect(sample.meta.css).toBe('font-size: 12px;');
  });

  it('reflects insertions, removals, and reordering while retaining filled data and example-only blocks', () => {
    const { before, sample, after } = fixture();
    const added = createEmptyBlock('text');
    added.schema.id = 'new';
    added.text = 'References';
    const local = createEmptyBlock('text');
    local.schema.id = 'local';
    local.text = 'Extra sample notes';
    sample.sections[0].blocks.push(local);
    after.sections[0].blocks = [after.sections[0].blocks[1], added];
    updateExampleContent(sample, before, after);
    expect(sample.sections[0].blocks.map((block) => block.text)).toEqual([
      'Engineer at Acme, 2020–2026', 'Extra sample notes', 'References',
    ]);
  });

  it('matches ordinary content across serialization, where editor identities are regenerated', () => {
    const { before, sample, after } = fixture();
    after.sections[0].blocks[0].text = 'Updated heading';
    const roundTrip = (document: typeof before) => deserializeDocumentBytes(serializeDocumentBytes(document), document.extension);
    const diskSample = roundTrip(sample);
    updateExampleContent(diskSample, roundTrip(before), roundTrip(after));
    expect(diskSample.sections[0].blocks[0].text).toContain('Updated heading');
    expect(diskSample.sections[0].blocks[1].text).toContain('Engineer at Acme');
  });

  it('updates nested component layout without replacing its filled data', () => {
    const { before, sample, after } = fixture();
    const definition = createEmptyBlock('container');
    definition.schema.containerBlocks = before.sections[0].blocks;
    before.meta.component_defs = [{ name: 'Profile', baseType: 'container', schema: definition.schema, template: definition }];
    after.meta.component_defs = structuredClone(before.meta.component_defs);
    const nextDefinition = (after.meta.component_defs as any[])[0].template;
    nextDefinition.schema.css = 'padding: 10px;';
    nextDefinition.schema.containerBlocks[0].text = 'New label';
    sample.meta.component_defs = structuredClone(before.meta.component_defs);
    const instance = structuredClone(definition);
    instance.schema.component = 'Profile';
    instance.schema.containerBlocks![1].text = 'Real person';
    sample.sections[0].blocks = [instance];
    updateExampleDefinitions(sample, after);
    expect(instance.schema.css).toBe('padding: 10px;');
    expect(instance.schema.containerBlocks![0].text).toBe('New label');
    expect(instance.schema.containerBlocks![1].text).toBe('Real person');
  });
});

it.each(['text', 'block'] as const)('propagates an explicit %s variable type within partially filled ordinary text', (type) => {
  const before = createBlankDocument('.thvy');
  const section = createEmptySection(1);
  const block = createEmptyBlock('text');
  block.text = 'Name: {% name %}\nBiography: {% biography %}';
  section.blocks = [block];
  before.sections = [section];
  const sample = structuredClone(before);
  sample.sections[0].blocks[0].text = 'Name: Ada Lovelace\nBiography: {% biography %}';
  const after = structuredClone(before);
  after.sections[0].blocks[0].text = `Name: {% name %}\nBiography: {% biography | ${type} %}`;
  updateExampleContent(sample, before, after);
  expect(sample.sections[0].blocks[0].text).toBe(`Name: Ada Lovelace\nBiography: {% biography | ${type} %}`);
});

it.each(['block', 'url'] as const)('keeps %s variable metadata through updating and serializing the example', async (type) => {
  const { setReusableTemplateVariableType, extractReusableTemplateVariablesFromDefinition } = await import('../../heavy-file-format/src/reusable-template-values');
  const before = createBlankDocument('.thvy');
  const block = createEmptyBlock('text');
  block.text = 'Name: {% name %}; Biography: {% biography %}';
  before.meta.component_defs = [{ name: 'Profile', baseType: 'text', schema: block.schema, template: block }];
  const section = createEmptySection(1);
  const instance = structuredClone(block);
  instance.schema.component = 'Profile';
  instance.text = 'Name: Ada Lovelace; Biography: {% biography %}';
  section.blocks = [instance];
  before.sections = [section];
  const sample = structuredClone(before);
  const after = structuredClone(before);
  const definition = (after.meta.component_defs as any[])[0];
  definition.templateVariables = { biography: { type } };
  if (type !== 'url') setReusableTemplateVariableType(definition.template, 'biography', type);
  updateExampleDefinitions(sample, after);
  const reopened = deserializeDocumentBytes(serializeDocumentBytes(sample), '.hvy');
  const savedDefinition = (reopened.meta.component_defs as any[])[0];
  expect(extractReusableTemplateVariablesFromDefinition(savedDefinition).find((variable) => variable.name === 'biography')?.type).toBe(type);
  expect(reopened.sections[0].blocks[0].text).toContain('Ada Lovelace');
  if (type === 'block') expect(reopened.sections[0].blocks[0].text).toContain('{% biography | block %}');
});

it('leaves instance text alone when the source has not changed', () => {
  const before = createBlankDocument('.thvy');
  const section = createEmptySection(1);
  const block = createEmptyBlock('text');
  block.text = 'Name: {% name %}; {% biography | block %}';
  section.blocks = [block];
  before.sections = [section];
  const sample = structuredClone(before);
  sample.sections[0].blocks[0].text = 'Name: Ada; {% biography %}';
  updateExampleContent(sample, before, structuredClone(before));
  expect(sample.sections[0].blocks[0].text).toBe('Name: Ada; {% biography %}');
});

it('does not rewrite instances when the stored definition matches the source', () => {
  const parent = createBlankDocument('.thvy');
  const definition = createEmptyBlock('text');
  definition.text = 'Name: {% name %}; {% biography | block %}';
  parent.meta.component_defs = [{ name: 'Profile', baseType: 'text', schema: definition.schema, template: definition, templateVariables: { biography: { type: 'block' } } }];
  const sample = structuredClone(parent);
  const section = createEmptySection(1);
  const instance = structuredClone(definition);
  instance.schema.component = 'Profile';
  instance.text = 'Name: Ada; {% biography %}';
  section.blocks = [instance];
  sample.sections = [section];
  updateExampleDefinitions(sample, parent);
  expect(instance.text).toBe('Name: Ada; {% biography %}');
});

it('makes template CSS authoritative on concrete instances, without changing either template version', () => {
  const { before, sample, after } = fixture();
  sample.meta.css = 'color: red;';
  sample.sections[0].css = 'margin: 99px;';
  sample.sections[0].blocks[1].schema.css = 'font-size: 8px;';
  after.meta.css = 'color: navy;';
  after.sections[0].css = 'margin: 12px;';
  after.sections[0].blocks[1].schema.css = 'font-size: 16px;';
  const originalBefore = structuredClone(before);
  const originalAfter = structuredClone(after);
  updateExampleContent(sample, before, after);
  expect(sample.meta.css).toBe('color: navy;');
  expect(sample.sections[0].css).toBe('margin: 12px;');
  expect(sample.sections[0].blocks[1].schema.css).toBe('font-size: 16px;');
  expect(sample.sections[0].blocks[1].text).toBe('Engineer at Acme, 2020–2026');
  expect(before).toEqual(originalBefore);
  expect(after).toEqual(originalAfter);
});

it('clears removed template CSS from instances even when their previous CSS differed', () => {
  const { before, sample, after } = fixture();
  before.meta.css = 'color: red;';
  before.sections[0].css = 'margin: 12px;';
  sample.meta.css = 'color: blue;';
  sample.sections[0].css = 'margin: 99px;';
  sample.sections[0].blocks[1].schema.css = 'font-size: 8px;';
  after.sections[0].css = '';
  after.sections[0].blocks[1].schema.css = '';
  updateExampleContent(sample, before, after);
  expect(sample.meta).not.toHaveProperty('css');
  expect(sample.sections[0].css).toBe('');
  expect(sample.sections[0].blocks[1].schema.css).toBe('');
  expect(sample.sections[0].blocks[1].text).toBe('Engineer at Acme, 2020–2026');
});

it('refreshes styling on every repeated reusable instance while retaining each instance’s values', () => {
  const parent = createBlankDocument('.thvy');
  const definition = createEmptyBlock('text');
  definition.text = 'Enter a name';
  definition.schema.css = 'color: navy;';
  definition.schema.align = 'center';
  parent.meta.component_defs = [{ name: 'Name', baseType: 'text', schema: definition.schema, template: definition }];
  const sample = structuredClone(parent);
  const section = createEmptySection(1);
  section.blocks = ['Ada', 'Grace'].map((text) => {
    const instance = createEmptyBlock('text');
    instance.schema.component = 'Name';
    instance.schema.css = 'color: red;';
    instance.schema.align = 'left';
    instance.text = text;
    return instance;
  });
  sample.sections = [section];
  (sample.meta.component_defs as any[])[0].template.schema.css = 'color: red;';
  (sample.meta.component_defs as any[])[0].template.schema.align = 'left';
  const originalParent = structuredClone(parent);
  updateExampleDefinitions(sample, parent);
  expect(section.blocks.map((block) => block.text)).toEqual(['Ada', 'Grace']);
  expect(section.blocks.map((block) => block.schema.css)).toEqual(['color: navy;', 'color: navy;']);
  expect(section.blocks.map((block) => block.schema.align)).toEqual(['center', 'center']);
  expect(parent).toEqual(originalParent);
  const reopened = deserializeDocumentBytes(serializeDocumentBytes(sample), '.hvy');
  expect(reopened.sections[0].blocks.map((block) => block.schema.css)).toEqual(['color: navy;', 'color: navy;']);
});

it('catches up from the example’s saved source snapshot and leaves repeat saves unchanged', async () => {
  const { rememberExampleTemplate } = await import('./templateExampleContent');
  const { before, sample, after } = fixture();
  rememberExampleTemplate(sample, before);
  const missedVersion = structuredClone(before);
  missedVersion.sections[0].title = 'Changed while example was unavailable';
  after.sections[0].title = missedVersion.sections[0].title;
  after.sections[0].blocks[0].schema.css = 'color: navy;';
  const reopened = deserializeDocumentBytes(serializeDocumentBytes(sample), '.hvy');
  updateExampleContent(reopened, missedVersion, after);
  expect(reopened.sections[0].title).toBe(after.sections[0].title);
  expect(reopened.sections[0].blocks[0].schema.css).toBe('color: navy;');
  expect(reopened.sections[0].blocks[1].text).toContain('Engineer at Acme');
  reopened.sections[0].blocks[0].schema.css = 'color: green;';
  updateExampleContent(reopened, before, after);
  expect(reopened.sections[0].blocks[0].schema.css).toBe('color: green;');
});

it('gives new nested components distinct editor identities in each concrete instance', () => {
  const parent = createBlankDocument('.thvy');
  const definition = createEmptyBlock('container');
  definition.schema.containerBlocks = [];
  parent.meta.component_defs = [{ name: 'profile', baseType: 'container', schema: definition.schema, template: definition }];
  const sample = structuredClone(parent);
  const section = createEmptySection(1);
  section.blocks = [1, 2].map(() => {
    const block = structuredClone(definition);
    block.schema.component = 'profile';
    return block;
  });
  sample.sections = [section];
  const added = createEmptyBlock('text');
  added.schema.id = 'new-field';
  added.text = 'New field';
  definition.schema.containerBlocks = [added];
  updateExampleDefinitions(sample, parent);
  const children = section.blocks.map((block) => block.schema.containerBlocks![0]);
  expect(children.map((block) => block.schema.id)).toEqual(['new-field', 'new-field']);
  expect(children[0].id).not.toBe(children[1].id);
  expect(children[0].id).not.toBe(added.id);
});

it('applies overlapping ordinary-body and reusable-definition additions only once', () => {
  const before = createBlankDocument('.thvy');
  const definition = createEmptyBlock('container');
  definition.schema.id = 'profile-root';
  const first = createEmptyBlock('text');
  first.schema.id = 'first';
  first.text = 'Fill me';
  definition.schema.containerBlocks = [first];
  before.meta.component_defs = [{ name: 'profile', baseType: 'container', schema: definition.schema, template: definition }];
  const section = createEmptySection(1);
  const instance = structuredClone(definition);
  instance.schema.component = 'profile';
  section.blocks = [instance];
  before.sections = [section];
  const sample = structuredClone(before);
  sample.sections[0].blocks[0].schema.containerBlocks![0].text = 'Real data';
  const after = structuredClone(before);
  const added = createEmptyBlock('text');
  added.schema.id = 'second';
  added.text = 'New field';
  (after.meta.component_defs as any[])[0].template.schema.containerBlocks.push(added);
  after.sections[0].blocks[0].schema.containerBlocks!.push(structuredClone(added));
  updateExampleContent(sample, before, after);
  updateExampleDefinitions(sample, after);
  expect(sample.sections[0].blocks[0].schema.containerBlocks!.map((block) => block.text)).toEqual(['Real data', 'New field']);
});

it('detaches concrete instances when their reusable definitions are removed', () => {
  const source = createBlankDocument('.thvy');
  const sample = createBlankDocument('.hvy');
  const definition = createEmptyBlock('text');
  definition.text = 'Template placeholder';
  sample.meta.component_defs = [{ name: 'profile', baseType: 'text', schema: definition.schema, template: definition }];
  const section = createEmptySection(1);
  sample.meta.section_defs = [{ name: 'Person', key: 'person', template: structuredClone(section) }];
  section.templateKey = 'person';
  const instance = createEmptyBlock('text');
  instance.schema.component = 'profile';
  instance.text = 'Real person';
  section.blocks = [instance];
  sample.sections = [section];
  updateExampleDefinitions(sample, source);
  expect(sample.meta.component_defs).toEqual([]);
  expect(sample.meta.section_defs).toEqual([]);
  expect(instance.schema.component).toBe('text');
  expect(instance.text).toBe('Real person');
  expect(section.templateKey).toBeUndefined();
});

it('ignores regenerated editor identities in nested grid slots', async () => {
  const { diffTemplateContent } = await import('./templateExampleContent');
  const before = createBlankDocument('.thvy');
  const section = createEmptySection(1);
  const grid = createEmptyBlock('grid');
  grid.schema.gridItems = [{ id: 'runtime-grid-old', idGenerated: true, block: createEmptyBlock('text') }];
  section.blocks = [grid];
  before.sections = [section];
  const after = structuredClone(before);
  after.sections[0].key = 'runtime-section-new';
  after.sections[0].blocks[0].id = 'runtime-block-new';
  after.sections[0].blocks[0].schema.gridItems[0].id = 'runtime-grid-new';
  expect(diffTemplateContent(before.sections, after.sections)).toBeNull();
});

it('updates a link label in a serialized concrete instance created through the reference template filler', async () => {
  const { applyReusableTemplateValues, extractReusableTemplateVariablesFromDefinition } = await import('../../heavy-file-format/src/reusable-template-values');
  const { cloneReusableBlockFromMeta } = await import('../../heavy-file-format/src/document-factory');
  const parent = createBlankDocument('.thvy');
  const definition = createEmptyBlock('text');
  definition.text = '[Fixed label]({% url %})';
  parent.meta.component_defs = [{ name: 'profile-link', baseType: 'text', schema: definition.schema, template: definition, templateVariables: { url: { type: 'url' } } }];
  const sample = structuredClone(parent);
  sample.extension = '.hvy';
  const section = createEmptySection(1);
  const instance = cloneReusableBlockFromMeta(definition, parent.meta);
  instance.schema.component = 'profile-link';
  applyReusableTemplateValues(instance, { url: 'https://example.com/profile' }, extractReusableTemplateVariablesFromDefinition((parent.meta.component_defs as any[])[0]));
  section.blocks = [instance];
  sample.sections = [section];
  const reopened = deserializeDocumentBytes(serializeDocumentBytes(sample), '.hvy');
  definition.text = '[Updated label]({% url %})';
  const savedParent = deserializeDocumentBytes(serializeDocumentBytes(parent), '.thvy');
  updateExampleDefinitions(reopened, savedParent);
  expect(reopened.sections[0].blocks[0].text).toBe('[Updated label](https://example.com/profile)');
});

it('updates schema-only reusable list records using their own document definitions', () => {
  const parent = createBlankDocument('.thvy');
  parent.meta.component_defs = [{ name: 'award-record', baseType: 'expandable', schema: {
    expandableContentBlocks: { children: [{ text: '^section-heading^ ### {% award %}', schema: { component: 'text', css: 'margin: 0;' } }] },
  } }];
  const sample = structuredClone(parent);
  const section = createEmptySection(1);
  const list = createEmptyBlock('component-list');
  const record = createEmptyBlock('award-record', false, sample.meta);
  record.schema.expandableContentBlocks!.children[0].text = '^section-heading^ ### Research award';
  list.schema.componentListBlocks = [record];
  section.blocks = [list];
  sample.sections = [section];
  const next = (parent.meta.component_defs as any[])[0].schema.expandableContentBlocks.children[0];
  next.text = '{% award %}';
  next.schema.css = 'margin: 0; font-weight: 700;';
  updateExampleDefinitions(sample, parent);
  expect(record.schema.expandableContentBlocks!.children[0].text).toBe('Research award');
  expect(record.schema.expandableContentBlocks!.children[0].schema.css).toBe('margin: 0; font-weight: 700;');
});
