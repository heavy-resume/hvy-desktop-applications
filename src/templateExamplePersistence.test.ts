import { beforeEach, expect, it, vi } from 'vitest';
import { createBlankDocument, createEmptyBlock, createEmptySection } from '../../heavy-file-format/src/document-factory';
import type { AppState } from './state';
import { serializeDocumentHeaderYaml } from '../../heavy-file-format/src/serialization';

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), readDocumentFile: vi.fn(), saveDocumentFile: vi.fn(),
  deserializeHvy: vi.fn(), serializeHvy: vi.fn(),
  state: { workspaces: [] as unknown[], document: null as AppState['document'] },
  documentSessions: new Map(), workspaceFilterDocumentCache: new Map(), mountCurrentDocument: vi.fn(),
}));
vi.mock('./backend', () => mocks);
vi.mock('./hvy', () => mocks);
vi.mock('./state', () => ({ state: mocks.state }));
vi.mock('./main', () => mocks);
import { readPreviousExampleTemplate, updateOpenedTemplateExample, updateSavedTemplateExamples } from './templateExamplePersistence';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.documentSessions.clear();
  mocks.workspaceFilterDocumentCache.clear();
  mocks.state.document = null;
});

it.each(['.thvy', '.phvy'] as const)('leaves the original %s template header and mounted document untouched when updating examples', async (extension) => {
  const before = createBlankDocument(extension);
  const section = createEmptySection();
  section.title = 'Original heading';
  const definition = createEmptyBlock('text');
  definition.text = 'Original component';
  before.meta.component_defs = [{ name: 'Greeting', baseType: 'text', template: definition }];
  const instance = structuredClone(definition);
  instance.schema.component = 'Greeting';
  section.blocks = [instance];
  before.sections = [section];
  const source = structuredClone(before);
  source.meta.title = 'Edited template title';
  source.sections[0].title = 'Edited heading';
  (source.meta.component_defs as unknown as Array<{ template: typeof definition }>)[0].template.text = 'Edited component';
  const sample = structuredClone(before);
  const template = { kind: 'file', name: `Resume${extension}`, path: `/work/templates/Resume${extension}`, relativePath: `templates/Resume${extension}`, extension };
  const exampleExtension = extension === '.phvy' ? '.phvy' : '.hvy';
  const file = { kind: 'file', name: `Example${exampleExtension}`, path: `/work/templates/Resume/Example${exampleExtension}`, relativePath: `templates/Resume/Example${exampleExtension}`, extension: exampleExtension };
  const workspace = { path: '/work', files: [{ kind: 'folder', children: [file] }, template] };
  mocks.state.workspaces = [workspace];
  mocks.loadWorkspace.mockResolvedValue(workspace);
  mocks.readDocumentFile.mockResolvedValue({ bytes: [2] });
  mocks.deserializeHvy.mockResolvedValueOnce(source).mockResolvedValueOnce(before).mockResolvedValueOnce(sample);
  mocks.serializeHvy.mockResolvedValue(new Uint8Array([3]));
  const mountedTemplate = structuredClone(source);
  const original = structuredClone(source);
  const originalBefore = structuredClone(before);
  const header = serializeDocumentHeaderYaml(source);
  const session = { source: template, document: mountedTemplate, dirty: true, recoveryState: 'keep' };
  mocks.documentSessions.set('template', session);
  mocks.state.document = { source: template, mounted: { document: mountedTemplate } } as unknown as AppState['document'];

  await updateSavedTemplateExamples({ path: template.path, bytes: [1] }, [0]);

  expect(sample.sections[0].title).toBe('Edited heading');
  expect(sample.sections[0].blocks[0].text).toBe('Edited component');
  expect(mocks.saveDocumentFile).toHaveBeenCalledExactlyOnceWith({ path: file.path, bytes: new Uint8Array([3]) });
  expect(source).toEqual(original);
  expect(before).toEqual(originalBefore);
  expect(mountedTemplate).toEqual(original);
  expect(serializeDocumentHeaderYaml(source)).toBe(header);
  expect(serializeDocumentHeaderYaml(mountedTemplate)).toBe(header);
  expect(session.recoveryState).toBe('keep');
  expect(mocks.mountCurrentDocument).not.toHaveBeenCalled();
  expect(await updateOpenedTemplateExample(template.path, mountedTemplate)).toBe(false);
  expect(await readPreviousExampleTemplate(file.path)).toBeUndefined();
});

it('writes updated examples and refreshes clean and dirty sessions without saving their unsaved notes', async () => {
  const source = createBlankDocument('.thvy');
  const sample = createBlankDocument('.hvy');
  const definition = createEmptyBlock('text');
  definition.text = 'New definition';
  source.meta.component_defs = [{ name: 'Greeting', baseType: 'text', template: definition }];
  const section = createEmptySection();
  const block = createEmptyBlock('text');
  block.schema.component = 'Greeting';
  block.text = 'Old';
  section.blocks = [block];
  sample.sections = [section];
  const file = { kind: 'file', name: 'Example 1.hvy', path: '/work/templates/Resume/Example 1.hvy', relativePath: 'templates/Resume/Example 1.hvy', extension: '.hvy' };
  const template = { kind: 'file', name: 'Resume.thvy', path: '/work/templates/Resume.thvy', relativePath: 'templates/Resume.thvy', extension: '.thvy' };
  const workspace = { path: '/work', files: [template, { kind: 'folder', name: 'Resume', relativePath: 'templates/Resume', children: [file] }] };
  mocks.state.workspaces = [workspace];
  mocks.loadWorkspace.mockResolvedValue(workspace);
  mocks.readDocumentFile.mockResolvedValue({ ...file, bytes: [2] });
  mocks.deserializeHvy.mockResolvedValueOnce(source).mockResolvedValueOnce(sample);
  mocks.serializeHvy.mockResolvedValue(new Uint8Array([3]));
  const dirtyDocument = structuredClone(sample);
  dirtyDocument.meta.title = 'Unsaved title';
  const dirty = { source: file, document: dirtyDocument, dirty: true, recoveryState: 'old' };
  const clean = { source: file, document: structuredClone(sample), dirty: false };
  mocks.documentSessions.set('dirty', dirty);
  mocks.documentSessions.set('clean', clean);
  await updateSavedTemplateExamples({ path: template.path, bytes: [1] });
  expect(mocks.saveDocumentFile).toHaveBeenCalledExactlyOnceWith({ path: file.path, bytes: new Uint8Array([3]) });
  expect(block.text).toBe('New definition');
  expect(clean.document).toBe(sample);
  expect(dirty.document.sections[0].blocks[0].text).toBe('New definition');
  expect(dirty.document.meta.title).toBe('Unsaved title');
  expect(dirty.dirty).toBe(true);
  expect(sample.meta.title).not.toBe('Unsaved title');
});

it('does not treat a PDF example as another template when saving it', async () => {
  mocks.state.workspaces = [{ path: '/work', files: [
    { kind: 'file', name: 'Resume.phvy', path: '/work/templates/Resume.phvy', relativePath: 'templates/Resume.phvy', extension: '.phvy' },
  ] }];
  mocks.loadWorkspace.mockResolvedValue(mocks.state.workspaces[0]);
  expect(await readPreviousExampleTemplate('/work/templates/Resume/Example 1.phvy')).toBeUndefined();
  await updateSavedTemplateExamples({ path: '/work/templates/Resume/Example 1.phvy', bytes: [1] });
  expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  expect(mocks.saveDocumentFile).not.toHaveBeenCalled();
});

it('applies ordinary template changes from the previous saved version to disk and dirty tabs', async () => {
  const before = createBlankDocument('.thvy');
  const section = createEmptySection();
  section.customId = 'profile';
  section.title = 'Profile';
  const block = createEmptyBlock('text');
  block.schema.id = 'name';
  block.text = 'Name';
  section.blocks = [block];
  before.sections = [section];
  const source = structuredClone(before);
  source.sections[0].title = 'Professional profile';
  source.sections[0].blocks[0].schema.css = 'font-weight: bold;';
  const sample = structuredClone(before);
  sample.sections[0].blocks[0].text = 'Ada Lovelace';
  const file = { kind: 'file', name: 'Example.hvy', path: '/work/templates/Profile/Example.hvy', relativePath: 'templates/Profile/Example.hvy', extension: '.hvy' };
  const template = { kind: 'file', name: 'Profile.thvy', path: '/work/templates/Profile.thvy', relativePath: 'templates/Profile.thvy', extension: '.thvy' };
  const workspace = { path: '/work', files: [template, { kind: 'folder', children: [file] }] };
  mocks.state.workspaces = [workspace];
  mocks.loadWorkspace.mockResolvedValue(workspace);
  mocks.readDocumentFile.mockResolvedValue({ ...file, bytes: [2] });
  mocks.deserializeHvy.mockResolvedValueOnce(source).mockResolvedValueOnce(before).mockResolvedValueOnce(sample);
  mocks.serializeHvy.mockResolvedValue(new Uint8Array([3]));
  const dirtyDocument = structuredClone(sample);
  dirtyDocument.sections[0].blocks[0].text = 'Grace Hopper';
  mocks.documentSessions.set('dirty', { source: file, document: dirtyDocument, dirty: true });
  await updateSavedTemplateExamples({ path: template.path, bytes: [1] }, [0]);
  expect(sample.sections[0].title).toBe('Professional profile');
  expect(sample.sections[0].blocks[0].text).toBe('Ada Lovelace');
  expect(sample.sections[0].blocks[0].schema.css).toBe('font-weight: bold;');
  expect(dirtyDocument.sections[0].title).toBe('Professional profile');
  expect(dirtyDocument.sections[0].blocks[0].text).toBe('Grace Hopper');
  expect(mocks.serializeHvy).toHaveBeenCalledWith(sample);
});


it.each([true, false])('propagates fixed link labels with templates visible in the navigator: %s', async (templatesVisible) => {
  const before = createBlankDocument('.thvy');
  const section = createEmptySection();
  const block = createEmptyBlock('text');
  block.text = '[Fixed label]({% url %})';
  section.blocks = [block];
  before.sections = [section];
  const source = structuredClone(before);
  source.sections[0].blocks[0].text = '[Updated label]({% url %})';
  const sample = structuredClone(before);
  sample.sections[0].blocks[0].text = '[Fixed label](https://example.com/profile)';
  const template = { kind: 'file', name: 'Profile.thvy', path: '/work/templates/Profile.thvy', relativePath: 'templates/Profile.thvy', extension: '.thvy' };
  const file = { kind: 'file', name: 'Example.hvy', path: '/work/templates/Profile/Example.hvy', relativePath: 'templates/Profile/Example.hvy', extension: '.hvy' };
  const workspace = { path: '/work', files: [template, { kind: 'folder', children: [file] }] };
  const documentsView = { path: '/work', files: [] };
  mocks.state.workspaces = [templatesVisible ? workspace : documentsView];
  mocks.loadWorkspace.mockImplementation(async (_path, options) => options?.includeTemplates ? workspace : documentsView);
  mocks.readDocumentFile.mockImplementation(async (path) => ({ bytes: path === template.path ? [0] : [2] }));
  mocks.deserializeHvy.mockResolvedValueOnce(source).mockResolvedValueOnce(before).mockResolvedValueOnce(sample);
  mocks.serializeHvy.mockResolvedValue(new Uint8Array([3]));

  const previous = await readPreviousExampleTemplate(template.path);
  expect(previous).toEqual([0]);
  await updateSavedTemplateExamples({ path: template.path, bytes: [1] }, previous);

  expect(sample.sections[0].blocks[0].text).toBe('[Updated label](https://example.com/profile)');
  expect(mocks.saveDocumentFile).toHaveBeenCalledExactlyOnceWith({ path: file.path, bytes: new Uint8Array([3]) });
});


it('catches up an opened example from its parent on disk and detects subsequent parent edits on tab return', async () => {
  const parent = createBlankDocument('.thvy');
  const section = createEmptySection();
  const block = createEmptyBlock('text');
  block.text = '[Original label]({% url %})';
  section.blocks = [block];
  parent.sections = [section];
  const sample = structuredClone(parent);
  const { rememberExampleTemplate } = await import('./templateExampleContent');
  rememberExampleTemplate(sample, parent);
  sample.sections[0].blocks[0].text = '[Original label](https://example.com)';
  sample.meta.title = 'Unsaved sample title';
  const template = { kind: 'file', name: 'Profile.thvy', path: '/work/templates/Profile.thvy', relativePath: 'templates/Profile.thvy', extension: '.thvy' };
  mocks.state.workspaces = [{ path: '/work', files: [] }];
  mocks.loadWorkspace.mockResolvedValue({ path: '/work', files: [template] });
  mocks.readDocumentFile.mockResolvedValue({ bytes: [1] });
  mocks.deserializeHvy.mockImplementation(async () => structuredClone(parent));
  const path = '/work/templates/Profile/Example.hvy';
  parent.sections[0].blocks[0].text = '[New label]({% url %})';
  expect(await updateOpenedTemplateExample(path, sample)).toBe(true);
  expect(sample.sections[0].blocks[0].text).toBe('[New label](https://example.com)');
  expect(sample.meta.title).toBe('Unsaved sample title');
  expect(await updateOpenedTemplateExample(path, sample)).toBe(false);
  parent.sections[0].blocks[0].schema.css = 'font-weight: bold;';
  expect(await updateOpenedTemplateExample(path, sample)).toBe(true);
  expect(sample.sections[0].blocks[0].schema.css).toBe('font-weight: bold;');
  expect(mocks.readDocumentFile).toHaveBeenCalledWith(template.path);
  expect(mocks.saveDocumentFile).not.toHaveBeenCalled();
});

it('does not migrate a parent template or an ordinary document on open', async () => {
  const template = { kind: 'file', name: 'Profile.thvy', path: '/work/templates/Profile.thvy', relativePath: 'templates/Profile.thvy', extension: '.thvy' };
  mocks.state.workspaces = [{ path: '/work', files: [template] }];
  mocks.loadWorkspace.mockResolvedValue(mocks.state.workspaces[0]);
  expect(await updateOpenedTemplateExample('/work/Document.hvy', createBlankDocument('.hvy'))).toBe(false);
  expect(await updateOpenedTemplateExample(template.path, createBlankDocument('.thvy'))).toBe(false);
  expect(mocks.readDocumentFile).not.toHaveBeenCalled();
});
