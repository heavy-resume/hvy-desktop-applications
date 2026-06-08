import { createDocumentHandlers } from './mainHandlersDocument';
import { createSettingsHandlers } from './mainHandlersSettings';
import { createWorkspaceHandlers } from './mainHandlersWorkspace';
import type { UiHandlers } from './ui';

export function createHandlers(): UiHandlers {
  const workspaceHandlers = createWorkspaceHandlers();
  return {
    ...workspaceHandlers,
    ...createSettingsHandlers(),
    ...createDocumentHandlers(workspaceHandlers.newDocumentInWorkspace as UiHandlers['newDocumentInWorkspace']),
  } as UiHandlers;
}
