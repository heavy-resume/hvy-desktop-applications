import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./main', () => ({}));
vi.mock('./mainWorkspaceUtils', () => ({}));

import type { HvySearchSnapshot } from '../../heavy-file-format/src/search/types';
import { findWorkspaceFilterSnapshot } from './mainWorkspaceFilter';
import { resetRuntimeDocuments, runtimeDocumentForFile, updateRuntimeDocumentFile } from './runtimeDocuments';
import type { WorkspaceFilterConfig } from './state';

describe('workspace filter results', () => {
  beforeEach(() => resetRuntimeDocuments());

  it('stay with a file renamed after filtering', () => {
    const file = runtimeDocumentForFile({ path: '/workspace/notes/plan.hvy', name: 'plan.hvy', extension: '.hvy' });
    const snapshot = { results: [{ id: 'match' }] } as unknown as HvySearchSnapshot;
    const filter: WorkspaceFilterConfig = { query: 'plan', mode: 'keyword', filterMode: 'show', targetDirectory: '', snapshots: { [file.documentId]: snapshot } } as unknown as WorkspaceFilterConfig;

    updateRuntimeDocumentFile(file, { path: '/workspace/journal/plan.hvy', name: 'plan.hvy', extension: '.hvy' });

    expect(findWorkspaceFilterSnapshot(filter, '/workspace/journal/plan.hvy')).toBe(snapshot);
    expect(findWorkspaceFilterSnapshot(filter, '/workspace/notes/plan.hvy')).toBeNull();
  });
});
