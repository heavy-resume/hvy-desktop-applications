import type { DocumentBackup, Workspace } from './backend';
import type { OpenDocument } from './state';
import { workspaceFileAccessInWorkspaces } from './workspaceFiles';

export type SaveConflictKind = 'discardRecoveryDraft' | 'overwriteRecoveryChanges' | 'overwriteOriginalChanges';

export function recoveryDocumentId(backupId: string): string {
  return `recovery-draft:${backupId}`;
}

export function recoveryDocumentTabName(name: string): string {
  return `${name} — Unsaved copy`;
}

export function recoveryDraftIdentity(
  document: Pick<OpenDocument, 'source' | 'displayName' | 'virtual'>,
): { path: string; name: string } {
  if (document.virtual === 'versionHistory') {
    return { path: '', name: document.displayName ?? document.source.name };
  }
  return { path: document.source.path, name: document.source.name };
}

export function mountedDocumentDirtyAfterMount(startedDirty: boolean, isNew: boolean, mountedDirty: boolean): boolean {
  return startedDirty || isNew || mountedDirty;
}

export function documentDirtyAfterMountedChange(
  mountedDirty: boolean,
  virtual: 'recoveryDraft' | 'defaultDocument' | 'versionHistory' | 'workspaceChat' | undefined,
  isNew: boolean,
): boolean {
  return mountedDirty || virtual === 'recoveryDraft' || isNew;
}

export function recoverySaveConflictKind(
  savingRecoveryDraft: boolean,
  originalDirty: boolean,
  recoveryModified: boolean,
): SaveConflictKind | null {
  if (savingRecoveryDraft) return originalDirty ? 'overwriteOriginalChanges' : null;
  return recoveryModified ? 'overwriteRecoveryChanges' : 'discardRecoveryDraft';
}

export function availableRecoveryBackups(backups: DocumentBackup[], workspaces: Workspace[]): DocumentBackup[] {
  const latestByDocument = new Map<string, DocumentBackup>();
  for (const backup of [...backups].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (backup.documentPath && workspaceFileAccessInWorkspaces(workspaces, backup.documentPath).archived) continue;
    const key = backup.documentPath || `untitled:${backup.name}`;
    if (!latestByDocument.has(key)) latestByDocument.set(key, backup);
  }
  return [...latestByDocument.values()];
}
