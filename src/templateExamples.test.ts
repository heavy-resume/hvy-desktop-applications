import { describe, expect, it } from 'vitest';
import { groupTemplateExamples, workspaceTemplateForExample } from './templateExamples';
import { updateExampleDefinitions } from './templateExampleUpdates';
import { createBlankDocument, createEmptyBlock, createEmptySection } from '../../heavy-file-format/src/document-factory';
import type { Workspace, WorkspaceTreeNode } from './backend';

const template: WorkspaceTreeNode = { kind: 'file', name: 'Resume.thvy', path: '/work/templates/Resume.thvy', relativePath: 'templates/Resume.thvy', extension: '.thvy' };
const example: WorkspaceTreeNode = { kind: 'file', name: 'Example 1.hvy', path: '/work/templates/Resume/Example 1.hvy', relativePath: 'templates/Resume/Example 1.hvy', extension: '.hvy' };
const folder: WorkspaceTreeNode = { kind: 'folder', name: 'Resume', path: '/work/templates/Resume', relativePath: 'templates/Resume', children: [example] };
const workspace = { path: '/work', files: [template, folder] } as Workspace;

describe('template examples', () => {
  it('groups the example directory under the template while keeping it a file', () => {
    expect(groupTemplateExamples(workspace.files)).toEqual([{ ...template, examples: [example] }]);
    expect(workspace.files).toEqual([template, folder]);
  });
  it('resolves the same template from either its own row or an example row', () => {
    expect(workspaceTemplateForExample(workspace, template.relativePath)).toBe(template);
    expect(workspaceTemplateForExample(workspace, example.relativePath)).toBe(template);
    expect(workspaceTemplateForExample(workspace, 'documents/Resume.hvy')).toBeNull();
  });
  it('leaves unrelated folders and templates without examples alone', () => {
    expect(groupTemplateExamples([template])).toEqual([template]);
    expect(groupTemplateExamples([folder])).toEqual([folder]);
  });
  it('updates nested reusable instances and keeps ordinary sample content and title', () => {
    const source = createBlankDocument('.thvy');
    const sample = createBlankDocument('.hvy');
    sample.meta.title = 'My sample';
    const definition = createEmptyBlock('text');
    definition.text = 'Updated definition';
    source.meta.component_defs = [{ name: 'Greeting', baseType: 'text', template: definition }];
    const section = createEmptySection(1);
    const ordinary = createEmptyBlock('text');
    ordinary.text = 'Sample-specific notes';
    const container = createEmptyBlock('container');
    const instance = createEmptyBlock('text');
    instance.schema.component = 'Greeting';
    instance.text = 'Old definition';
    container.schema.containerBlocks = [instance];
    section.blocks = [ordinary, container];
    sample.sections = [section];
    const id = instance.id;
    updateExampleDefinitions(sample, source);
    expect(instance.text).toBe('Updated definition');
    expect(instance.id).toBe(id);
    expect(instance.schema.component).toBe('Greeting');
    expect(ordinary.text).toBe('Sample-specific notes');
    expect(sample.meta.title).toBe('My sample');
    expect(sample.meta.component_defs).toEqual(source.meta.component_defs);
    expect(sample.meta.component_defs).not.toBe(source.meta.component_defs);
  });
  it('updates section-template instances using their template key', () => {
    const source = createBlankDocument('.thvy');
    const sample = createBlankDocument('.hvy');
    const definition = createEmptySection(1);
    definition.title = 'Updated section';
    source.meta.section_defs = [{ name: 'Profile', key: 'profile', template: definition }];
    const instance = createEmptySection(2);
    instance.templateKey = 'profile';
    instance.title = 'Old section';
    const key = instance.key;
    sample.sections = [instance];
    updateExampleDefinitions(sample, source);
    expect(instance.title).toBe('Updated section');
    expect(instance.key).toBe(key);
    expect(instance.level).toBe(2);
    expect(instance.templateKey).toBe('profile');
  });
});

it('does not reset filled reusable instances when their definition did not change', () => {
  const source = createBlankDocument('.thvy');
  const sample = createBlankDocument('.hvy');
  const definition = createEmptyBlock('text');
  definition.text = 'Template text';
  source.meta.component_defs = [{ name: 'Greeting', baseType: 'text', template: definition }];
  sample.meta.component_defs = structuredClone(source.meta.component_defs);
  const section = createEmptySection(1);
  const instance = createEmptyBlock('text');
  instance.schema.component = 'Greeting';
  instance.text = 'Filled example text';
  section.blocks = [instance];
  sample.sections = [section];
  updateExampleDefinitions(sample, source);
  expect(instance.text).toBe('Filled example text');
});
