import { findFileInWorkspaces, workspacePathForFileInWorkspaces, type AppState } from './state';

export interface FileActionAvailability {
  openHomepage: boolean;
  closeDocument: boolean;
  save: boolean;
  saveAs: boolean;
  saveToWorkspace: boolean;
  exportPdf: boolean;
  importCurrent: boolean;
  encryptDocument: boolean;
  decryptDocument: boolean;
  documentEncryptionUnsavedChanges: boolean;
}

export function getFileActionAvailability(state: AppState): FileActionAvailability {
  const document = state.document;
  const hasDocument = Boolean(document);
  const editableDocument = Boolean(document && !document.readOnly);
  const mountedEditableDocument = Boolean(document?.mounted && editableDocument);
  const historyPreview = document?.virtual === 'versionHistory';
  const editableTemplateDocument = Boolean(document && editableDocument && isWorkspaceTemplatePath(state, document.source.path));
  const editableHvyDocument = Boolean(document && editableDocument && document.source.extension !== '.md');
  const documentEncryptionAvailable = Boolean(mountedEditableDocument && editableHvyDocument && document?.mode !== 'hvy');
  const documentEncrypted = document?.mounted?.document.encryption?.encrypted === true;
  const encryptedFolderDocument = Boolean(document?.source.path && findFileInWorkspaces(state.workspaces, document.source.path)?.encryptedFolderKeyId);
  const documentEncryptionActionAvailable = documentEncryptionAvailable && (!documentEncrypted || !encryptedFolderDocument);
  const documentEncryptionHasUnsavedChanges = documentEncryptionActionAvailable && Boolean(document?.dirty);
  const documentWorkspacePath = currentDocumentWorkspacePath(state);
  const hasWorkspaceDestination = state.workspaces.some((workspace) => workspace.path !== documentWorkspacePath);

  return {
    openHomepage: state.appSettings.homepage.kind !== 'none',
    closeDocument: hasDocument,
    save: historyPreview || Boolean((document?.dirty || editableTemplateDocument) && editableDocument),
    saveAs: historyPreview || mountedEditableDocument,
    saveToWorkspace: Boolean(mountedEditableDocument && hasWorkspaceDestination),
    exportPdf: Boolean(document?.source.extension === '.phvy' && mountedEditableDocument && !editableTemplateDocument),
    importCurrent: editableHvyDocument,
    encryptDocument: documentEncryptionAvailable && !documentEncrypted && !documentEncryptionHasUnsavedChanges,
    decryptDocument: documentEncryptionAvailable && documentEncrypted && !encryptedFolderDocument && !documentEncryptionHasUnsavedChanges,
    documentEncryptionUnsavedChanges: documentEncryptionHasUnsavedChanges,
  };
}

export function isHomepageOpen(state: AppState): boolean {
  const homepage = state.appSettings.homepage;
  const document = state.document;
  if (!document) return false;
  if (homepage.kind === 'included') return document.includedDocumentId === homepage.id;
  if (homepage.kind === 'file') return !document.virtual && document.source.path === homepage.path;
  return false;
}

export function isWorkspaceTemplatePath(state: AppState, path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  return state.workspaces.some((workspace) => {
    const workspacePath = workspace.path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalizedPath.startsWith(`${workspacePath}/templates/`);
  });
}

export function currentDocumentWorkspacePath(state: AppState): string | null {
  const path = state.document?.source.path;
  if (!path) return null;
  return workspacePathForFileInWorkspaces(state.workspaces, path);
}
