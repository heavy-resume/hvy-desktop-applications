import { describe, expect, it, vi } from 'vitest';

vi.mock('./core', () => ({
  formatBackupTimestamp: (value: string) => value,
}));

import { state, type AppState } from '../state';
import { renderVersionHistorySidebar } from './render-document-dialogs';

describe('renderVersionHistorySidebar', () => {
  it('renders saved versions, the active revision, and an explicit close action', () => {
    const historyState = {
      ...state,
      versionHistorySourcePath: '/workspace/Example.hvy',
      versionHistorySourceName: 'Example.hvy',
      selectedSavedVersionId: 'older',
      savedDocumentVersions: [
        {
          id: 'latest',
          documentPath: '/workspace/Example.hvy',
          createdAt: '2026-09-02T12:00:00.000Z',
          heads: ['latest'],
          userId: 'user',
          displayName: 'User',
        },
        {
          id: 'older',
          documentPath: '/workspace/Example.hvy',
          createdAt: '2026-09-01T12:00:00.000Z',
          heads: ['older'],
          userId: 'user',
          displayName: 'User',
        },
      ],
    } as AppState;

    const html = renderVersionHistorySidebar(historyState);

    expect(html).toContain('Version History');
    expect(html).toContain('Example.hvy');
    expect(html).toContain('data-action="close-version-history"');
    expect(html).toContain('data-version-id="latest"');
    expect(html).toContain('data-version-id="older" aria-current="true"');
  });
});
