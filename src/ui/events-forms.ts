import { type AppState } from '../state';
import { commitImportTagEditorDrafts } from './events-controls';
import { readAiSettingsForm, readAppSettingsForm, readMcpSettingsForm } from './render-ai-mcp';
import { isImportOutputMode, isNewWorkspaceLocation, isTemplateExtension, isTemplateScope } from './render-workspaces';
import { UiHandlers } from './types';

export function bindFormEvents(root: HTMLElement, handlers: UiHandlers, state: AppState, signal: AbortSignal): void {
  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    if (form.closest('#hvyMount') && form.dataset.form !== 'workspace-chat') return;
    event.preventDefault();
    if (form.dataset.form === 'new-workspace') {
      const data = new FormData(form);
      const location = String(data.get('workspaceLocation') ?? 'managed');
      handlers.createWorkspace(
        String(data.get('workspaceName') ?? ''),
        isNewWorkspaceLocation(location) ? location : 'managed'
      );
    }
    if (form.dataset.form === 'workspace-manager-rename') {
      const data = new FormData(form);
      handlers.renameWorkspace(String(data.get('workspacePath') ?? ''), String(data.get('workspaceName') ?? ''));
    }
    if (form.dataset.form === 'new-document') {
      const data = new FormData(form);
      handlers.createDocumentInWorkspace(
        String(data.get('documentName') ?? ''),
        String(data.get('templateId') ?? ''),
        String(data.get('targetDirectory') ?? '')
      );
    }
    if (form.dataset.form === 'new-folder') {
      const data = new FormData(form);
      handlers.createWorkspaceFolder(
        String(data.get('workspacePath') ?? ''),
        String(data.get('parentDirectory') ?? ''),
        String(data.get('folderName') ?? ''),
        data.get('encrypted') === 'true'
      );
    }
    if (form.dataset.form === 'rename-encrypted-folder') {
      const data = new FormData(form);
      handlers.submitRenameEncryptedFolder(String(data.get('folderName') ?? ''));
    }
    if (form.dataset.form === 'import-document') {
      commitImportTagEditorDrafts(form, handlers);
      const data = new FormData(form);
      handlers.createImportedDocument(
        String(data.get('documentName') ?? ''),
        String(data.get('templateId') ?? ''),
        String(data.get('instructions') ?? ''),
        String(data.get('importSourceText') ?? ''),
        String(data.get('excludeTags') ?? ''),
        data.get('newSectionsOnly') === 'on',
        String(data.get('targetDirectory') ?? '')
      );
    }
    if (form.dataset.form === 'import-current') {
      commitImportTagEditorDrafts(form, handlers);
      const data = new FormData(form);
      const outputMode = String(data.get('importOutputMode') ?? 'current');
      handlers.importIntoCurrent(
        String(data.get('instructions') ?? ''),
        String(data.get('importSourceText') ?? ''),
        String(data.get('excludeTags') ?? ''),
        data.get('newSectionsOnly') === 'on',
        isImportOutputMode(outputMode) ? outputMode : 'current',
        String(data.get('importOutputName') ?? '')
      );
    }
    if (form.dataset.form === 'export-document') {
      const data = new FormData(form);
      const scope = String(data.get('scope') ?? 'app');
      const extension = data.get('format');
      handlers.saveAsTemplate(
        String(data.get('templateName') ?? ''),
        isTemplateScope(scope) ? scope : 'app',
        isTemplateExtension(extension) ? extension : '.thvy'
      );
    }
    if (form.dataset.form === 'save-as-template') {
      const data = new FormData(form);
      const scope = String(data.get('scope') ?? 'app');
      const extension = data.get('format');
      handlers.saveAsTemplate(
        String(data.get('templateName') ?? ''),
        isTemplateScope(scope) ? scope : 'app',
        isTemplateExtension(extension) ? extension : '.thvy'
      );
    }
    if (form.dataset.form === 'app-settings') {
      const data = new FormData(form);
      handlers.saveAppSettings(readAppSettingsForm(data, state.document?.source.path ?? ''));
    }
    if (form.dataset.form === 'add-integration-page') {
      const data = new FormData(form);
      handlers.addIntegrationPage(String(data.get('pageName') ?? ''), String(data.get('pageUrl') ?? ''));
    }
    if (form.dataset.form === 'integration-ready-checks') {
      const data = new FormData(form);
      const mode = String(data.get('urlMode'));
      const integrationId = String(data.get('integrationId') ?? '');
      const pageId = String(data.get('pageId') ?? '');
      if (mode === 'strict-url' || mode === 'strict-domain' || mode === 'domain-regex') {
        const expectedValues = Object.fromEntries([...data.entries()].flatMap(([key, value]) => key.startsWith('readyValue:') ? [[key.slice('readyValue:'.length), String(value)]] : []));
        handlers.saveIntegrationReadyChecks(integrationId, pageId, mode, String(data.get('urlValue') ?? ''), expectedValues);
      }
    }
    if (form.dataset.form === 'add-integration-profile') {
      const data = new FormData(form);
      handlers.addIntegrationProfile(String(data.get('profileName') ?? ''));
    }
    if (form.dataset.form === 'approve-webmcp-tool') {
      const data = new FormData(form);
      handlers.approveIntegrationWebMcpTool(data.get('scriptingEnabled') === 'on', data.get('mcpExposed') === 'on');
    }
    if (form.dataset.form === 'invoke-webmcp-tool') {
      const data = new FormData(form);
      try {
        const args = JSON.parse(String(data.get('arguments') ?? '{}')) as unknown;
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
        handlers.invokeIntegrationWebMcpTool(String(data.get('capabilityId') ?? ''), args as Record<string, unknown>);
      } catch (error) {
        let message = form.querySelector<HTMLElement>('.integration-webmcp-input-error');
        if (!message) {
          message = document.createElement('p');
          message.className = 'integration-fetch-error integration-webmcp-input-error';
          message.setAttribute('role', 'alert');
          form.querySelector('.dialog-actions')?.before(message);
        }
        message.textContent = error instanceof Error ? error.message : String(error);
      }
    }
    if (form.dataset.form === 'integration-action-instructions') {
      const data = new FormData(form);
      handlers.reviewIntegrationActionRequest(String(data.get('actionName') ?? ''), String(data.get('actionDescription') ?? ''));
    }
    if (form.dataset.form === 'integration-command-reconcile') {
      const data = new FormData(form);
      const inputNames: Record<string, string> = {};
      for (const [key, value] of data.entries()) {
        if (key.startsWith('recordedInput:')) inputNames[key.slice('recordedInput:'.length)] = String(value);
      }
      handlers.saveIntegrationCommand(String(data.get('commandName') ?? ''), inputNames);
    }
    if (form.dataset.form === 'integration-command-run') {
      const inputs: Record<string, string> = {};
      for (const [key, value] of new FormData(form).entries()) {
        if (key.startsWith('commandInput:')) inputs[key.slice('commandInput:'.length)] = String(value);
      }
      handlers.submitIntegrationCommandRun(inputs);
    }
    if (form.dataset.form === 'ai-settings') {
      const data = new FormData(form);
      handlers.saveAiSettings(readAiSettingsForm(data));
    }
    if (form.dataset.form === 'mcp-settings') {
      const data = new FormData(form);
      handlers.saveMcpSettings(readMcpSettingsForm(data));
    }
    if (form.dataset.form === 'workspace-filter') {
      handlers.submitWorkspaceFilter();
    }
    if (form.dataset.form === 'workspace-chat') {
      handlers.submitWorkspaceChat();
    }
    if (form.dataset.form === 'rename-file') {
      const data = new FormData(form);
      handlers.submitRenameFile(String(data.get('fileName') ?? ''));
    }
    if (form.dataset.form === 'workspace-transfer') {
      const data = new FormData(form);
      const destination = form.querySelector<HTMLInputElement>('input[name="workspaceDestination"]:checked');
      handlers.submitWorkspaceTransfer(
        destination?.dataset.workspacePath ?? '',
        String(data.get('fileName') ?? ''),
        destination?.dataset.targetDirectory ?? ''
      );
    }
    if (form.dataset.form === 'save-as-document') {
      const data = new FormData(form);
      if (String(data.get('scope') ?? 'workspace') === 'anywhere') {
        handlers.saveAsAnywhere();
      } else {
        handlers.saveAsToWorkspace(
          String(data.get('workspacePath') ?? ''),
          String(data.get('fileName') ?? ''),
          String(data.get('targetDirectory') ?? '')
        );
      }
    }
  }, { signal });
  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (target.dataset.field === 'workspace-chat-draft') {
      handlers.updateWorkspaceChatDraft(target.value);
      const form = target.closest<HTMLFormElement>('form[data-form="workspace-chat"]');
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit) {
        submit.disabled = target.value.trim().length === 0;
      }
    }
  }, { signal });
  root.addEventListener('hvy:open-workspace-link', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const href = typeof event.detail?.href === 'string' ? event.detail.href : '';
    if (href) handlers.openWorkspaceLink(href);
  }, { signal });
}
