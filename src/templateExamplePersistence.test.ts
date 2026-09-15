import { beforeEach, expect, it, vi } from 'vitest';
import { createBlankDocument, createEmptyBlock, createEmptySection } from '../../heavy-file-format/src/document-factory';

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), readDocumentFile: vi.fn(), saveDocumentFile: vi.fn(),
  deserializeHvy: vi.fn(), serializeHvy: vi.fn(),
  state: { workspaces: [] as unknown[], document: null },
  documentSessions: new Map(), workspaceFilterDocumentCache: new Map(), mountCurrentDocument: vi.fn(),
}));
vi.mock('./backend', () => mocks);
vi.mock('./hvy', () => mocks);
vi.mock('./state', () => ({ state: mocks.state }));
vi.mock('./main', () => mocks);
import { updateSavedTemplateExamples } from './templateExamplePersistence';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.documentSessions.clear();
  mocks.workspaceFilterDocumentCache.clear();
});

it('writes updated examples and refreshes clean and dirty sessions without saving their unsaved notes', async () => {
  const source = createBlankDocument('.thvy');
  const sample = createBlankDocument('.hvy');
  const definition = createEmptyBlock('text');
  definition.text = 'New definition';
  source.meta.component_defs = [{ name: 'Greeting', baseType: 'text', template: definition }];
  const section = createEmptySection(1);
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
  await updateSavedTemplateExamples({ path: '/work/templates/Resume/Example 1.phvy', bytes: [1] });
  expect(mocks.loadWorkspace).not.toHaveBeenCalled();
});
