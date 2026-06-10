import { describe, expect, it, vi } from 'vitest';

vi.mock('./main', () => ({
  adoptSavedAsDocument: vi.fn(),
  backupDocumentKey: vi.fn(),
  clearRecoveryDraftsForDocument: vi.fn(),
  documentSessions: new Map(),
  moveBackupTracking: vi.fn(),
  openDocument: vi.fn(),
  pendingMountDocument: null,
  readDocumentColorPreference: vi.fn(),
  refreshRecents: vi.fn(),
  renameDocumentTabPath: vi.fn(),
  rerender: vi.fn(),
  runBusy: vi.fn(),
  updateCurrentDocumentSession: vi.fn(),
}));

import { creationTemplate } from './mainWorkspaceUtils';
import { state } from './state';

describe('creationTemplate', () => {
  it('uses the bundled PHVY template for new PHVY documents', () => {
    state.savedTemplates = [];
    state.workspaces = [];

    const template = creationTemplate(null, 'phvy', 'blank.phvy', 'Portfolio');

    expect(template).toContain('title: "Portfolio"');
    expect(template).toContain('heading_styles:');
    expect(template).toContain('margin: 2rem 0 0.5rem');
    expect(template).toContain('component_defaults:');
    expect(template).toContain('css: "margin: 0.5rem 0;"');
  });

  it('keeps plain HVY new documents minimal when no template is selected', () => {
    const template = creationTemplate(null, 'hvy', 'blank', 'Notes');

    expect(template).toBe(`---
hvy_version: 0.1
title: "Notes"
---
`);
  });
});
