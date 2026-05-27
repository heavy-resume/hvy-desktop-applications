import type { AppState } from './state';

export interface FileActionAvailability {
  closeDocument: boolean;
  save: boolean;
  saveAs: boolean;
  saveToWorkspace: boolean;
  exportPdf: boolean;
  importCurrent: boolean;
}

export function getFileActionAvailability(state: AppState): FileActionAvailability {
  const document = state.document;
  const hasDocument = Boolean(document);
  const editableDocument = Boolean(document && !document.readOnly);
  const mountedEditableDocument = Boolean(document?.mounted && editableDocument);
  const editableTemplateDocument = Boolean(document && editableDocument && isTemplatePath(state, document.path));
  const editableHvyDocument = Boolean(document && editableDocument && document.extension !== '.md');
  const documentWorkspacePath = currentDocumentWorkspacePath(state);

  return {
    closeDocument: hasDocument,
    save: Boolean((document?.dirty || editableTemplateDocument) && editableDocument),
    saveAs: mountedEditableDocument,
    saveToWorkspace: Boolean(document && editableDocument && state.workspaces.length > 0 && !documentWorkspacePath),
    exportPdf: Boolean(document?.extension === '.phvy' && mountedEditableDocument),
    importCurrent: editableHvyDocument,
  };
}

function isTemplatePath(state: AppState, path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  return state.workspaces.some((workspace) => {
    const workspacePath = workspace.path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalizedPath.startsWith(`${workspacePath}/templates/`);
  });
}

export function currentDocumentWorkspacePath(state: AppState): string | null {
  const path = state.document?.path;
  if (!path) return null;
  return state.workspaces.find((workspace) => path.startsWith(workspace.path))?.path ?? null;
}
