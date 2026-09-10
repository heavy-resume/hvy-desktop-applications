import { describe, expect, it } from 'vitest';
import type { DocumentBackup, Workspace } from './backend';
import { availableRecoveryBackups, documentDirtyAfterMountedChange, mountedDocumentDirtyAfterMount, recoveryDocumentId, recoveryDocumentTabName, recoveryDraftIdentity, recoverySaveConflictKind } from './recoveryDocuments';

describe('recovery document identity', () => {
  it('uses a distinct tab identity and label for an unsaved copy', () => {
    expect(recoveryDocumentId('draft-123')).toBe('recovery-draft:draft-123');
    expect(recoveryDocumentId('draft-123')).not.toBe('/tmp/work/Notes.hvy');
    expect(recoveryDocumentTabName('Notes.hvy')).toBe('Notes.hvy — Unsaved copy');
  });

  it('backs up an edited history snapshot as an untitled copy', () => {
    expect(recoveryDraftIdentity({
      source: {
        documentId: 'history-document',
        workingVersionId: 'history-version',
        path: 'version-history:%2Ftmp%2Fwork%2FNotes.hvy:saved-version',
        name: 'Notes.hvy — saved version',
        extension: '.hvy',
      },
      displayName: 'Notes.hvy — September 2, 2026',
      virtual: 'versionHistory',
    })).toEqual({
      path: '',
      name: 'Notes.hvy — September 2, 2026',
    });
  });

  it('keeps a recovered document dirty when mounting reports its clean internal baseline', () => {
    expect(mountedDocumentDirtyAfterMount(true, false, false)).toBe(true);
    expect(mountedDocumentDirtyAfterMount(false, false, false)).toBe(false);
    expect(mountedDocumentDirtyAfterMount(false, false, true)).toBe(true);
  });

  it('keeps a recovered document dirty when the mounted document later reports clean', () => {
    expect(documentDirtyAfterMountedChange(false, 'recoveryDraft', false)).toBe(true);
    expect(documentDirtyAfterMountedChange(false, undefined, false)).toBe(false);
    expect(documentDirtyAfterMountedChange(true, undefined, false)).toBe(true);
  });
});

describe('recovery save conflicts', () => {
  it('asks to discard an untouched recovery tab before saving the modified original', () => {
    expect(recoverySaveConflictKind(false, true, false)).toBe('discardRecoveryDraft');
  });

  it('lets a modified recovery draft replace an unchanged original without another prompt', () => {
    expect(recoverySaveConflictKind(true, false, true)).toBeNull();
  });

  it('identifies which competing changes would be overwritten when both tabs were modified', () => {
    expect(recoverySaveConflictKind(false, true, true)).toBe('overwriteRecoveryChanges');
    expect(recoverySaveConflictKind(true, true, true)).toBe('overwriteOriginalChanges');
  });
});

describe('availableRecoveryBackups', () => {
  it('hides archived documents and keeps only the newest draft per document', () => {
    const workspaces: Workspace[] = [{
      path: '/tmp/work',
      manifest: {
        schemaVersion: 1,
        name: 'Work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      files: [
        {
          kind: 'file',
          name: 'Archived.hvy',
          path: '/tmp/work/Archived.hvy',
          relativePath: 'Archived.hvy',
          extension: '.hvy',
          archived: true,
        },
        {
          kind: 'file',
          name: 'Notes.hvy',
          path: '/tmp/work/Notes.hvy',
          relativePath: 'Notes.hvy',
          extension: '.hvy',
          archived: false,
        },
      ],
    }];
    const backups: DocumentBackup[] = [
      backup('archived', '/tmp/work/Archived.hvy', 'Archived.hvy', '2026-08-03T12:00:00.000Z'),
      backup('older', '/tmp/work/Notes.hvy', 'Notes.hvy', '2026-08-03T10:00:00.000Z'),
      backup('newer', '/tmp/work/Notes.hvy', 'Notes.hvy', '2026-08-03T11:00:00.000Z'),
    ];

    expect(availableRecoveryBackups(backups, workspaces).map((candidate) => candidate.id)).toEqual(['newer']);
  });
});

function backup(id: string, documentPath: string, name: string, createdAt: string): DocumentBackup {
  return { id, documentPath, name, extension: '.hvy', createdAt };
}
