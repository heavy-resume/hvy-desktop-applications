import { markdownToReaderHtml, normalizeMarkdownLists } from '../../../heavy-file-format/src/markdown';
import type { HvyDocumentSearchMode, SearchFilterMode } from '../../../heavy-file-format/src/search/types';
import { type AiSettings, type Workspace, type WorkspaceTemplateVisibility, type WorkspaceTreeNode } from '../backend';
import { currentDocumentWorkspacePath } from '../fileActions';
import { savedVersionDocumentName } from '../mainUtilities';
import { workspacePathForFileInWorkspaces, type AppState, type WorkspaceFilterState } from '../state';
import { workspaceTemplateVisibility } from '../templates';
import { closeIcon, eyeIcon, funnelIcon, gearIcon, sparklesIcon } from './render-shell';
import { displayDocumentName, normalizeTreeRelativePath } from './render-workspaces';
import { escapeAttr, escapeHtml } from './shared';

export function renderWorkspaceFilterDialog(
  filter: WorkspaceFilterState,
  workspaces: Workspace[],
  activeFilters: AppState['workspaceFilters'],
  aiSettings: AiSettings,
  embeddingPreviews: AppState['workspaceEmbeddingPreviews'],
): string {
  if (!filter.open) {
    return '';
  }
  const scopedWorkspace = filter.workspacePath ? workspaces.find((workspace) => workspace.path === filter.workspacePath) ?? null : null;
  const workspaceName = scopedWorkspace?.manifest.name ?? 'workspace';
  const filterTargetName = filter.targetDirectory ? workspaceFilterFolderName(filter.targetDirectory) : workspaceName;
  const activeFilter = filter.workspacePath ? activeFilters[filter.workspacePath] : null;
  const applied = Boolean(
    activeFilter
    && normalizeTreeRelativePath(activeFilter.targetDirectory) === normalizeTreeRelativePath(filter.targetDirectory)
    && activeFilter.query.trim() === filter.queryDraft.trim()
    && activeFilter.mode === filter.mode
    && activeFilter.filterMode === filter.filterMode
  );
  const isSemantic = filter.mode === 'semantic';
  const isEmbedding = filter.mode === 'embedding';
  const stopRunningFilter = filter.isLoading && (isSemantic || isEmbedding);
  const submitLabel = stopRunningFilter ? 'Stop' : applied ? 'Update filter' : 'Filter';
  const visibility = workspaceTemplateVisibility(scopedWorkspace);
  const status = filter.isLoading
    ? filter.status ?? (isEmbedding ? '' : isSemantic ? `Analyzing ${filterTargetName}...` : `Filtering ${filterTargetName}...`)
    : filter.error
      ? filter.error
      : '';
  return `
    <section class="workspace-filter-overlay" aria-label="Workspace filter">
      <div class="workspace-filter-backdrop" data-action="close-workspace-filter"></div>
      <form class="workspace-filter-dialog${isSemantic ? ' is-semantic-mode' : ''}${isEmbedding ? ' is-embedding-mode' : ''}" data-form="workspace-filter" data-workspace-path="${escapeAttr(filter.workspacePath ?? '')}" data-loading="${filter.isLoading ? 'true' : 'false'}" role="dialog" aria-modal="true" aria-label="Filter workspace">
        <div class="search-tabbar">
          <div class="workspace-filter-title">
            ${funnelIcon()}
            <span>Filter ${escapeHtml(filterTargetName)}</span>
          </div>
          <button type="button" class="hvy-galaxy-button search-close-button ghost remove-x" data-action="close-workspace-filter" aria-label="Close workspace filter">${closeIcon()}</button>
        </div>
        ${renderWorkspaceFilterVisibilityControls(visibility, filter.isLoading, filter.workspacePath ?? '', filter.workspacePath ? embeddingPreviews[filter.workspacePath] ?? null : null)}
        <div class="search-input-row">
          <span class="search-input-icon" aria-hidden="true">${funnelIcon()}</span>
          <label>
            <span>Filter document</span>
            ${isSemantic || isEmbedding
      ? `<textarea class="hvy-galaxy-textarea search-input search-prompt-textarea" data-field="workspace-filter-query" placeholder="Describe what should stay visible" rows="4" autofocus>${escapeHtml(filter.queryDraft)}</textarea>`
      : `<input class="hvy-galaxy-input search-input" data-field="workspace-filter-query" value="${escapeAttr(filter.queryDraft)}" placeholder="Filter document" autocomplete="off" spellcheck="false" autofocus>`
    }
          </label>
        </div>
        ${status ? `<div class="search-status${filter.error ? ' is-error' : ''}" role="status">${escapeHtml(status)}</div>` : ''}
        <div class="search-filter-box">
          <div class="search-filter-box-head">
            ${funnelIcon()}
            <span>Filter Technique</span>
            ${renderWorkspaceFilterModeButton('keyword', 'Keyword', filter)}
            ${renderWorkspaceFilterModeButton('semantic', 'Semantic', filter)}
            ${renderWorkspaceFilterModeButton('embedding', 'Embeddings', filter, !aiSettings.embeddings.enabled)}
          </div>
          <div class="search-filter-technique-note">${escapeHtml(workspaceFilterModeDescription(filter.mode))}</div>
          <div class="search-filter-mode-group" role="group" aria-label="Filter behavior">
            ${renderWorkspaceFilterBehaviorButton('deprioritize', 'Shade', filter)}
            ${renderWorkspaceFilterBehaviorButton('hide', 'Hide', filter)}
          </div>
        </div>
        <div class="workspace-filter-actions">
          <button
            type="submit"
            class="hvy-galaxy-button secondary${applied ? ' is-active' : ''}"
            data-role="workspace-filter-submit"
            aria-pressed="${applied ? 'true' : 'false'}"
            ${!stopRunningFilter && (filter.isLoading || filter.queryDraft.trim().length === 0) ? 'disabled' : ''}
          >${submitLabel}</button>
          ${activeFilter ? `<button type="button" class="hvy-galaxy-button ghost" data-action="clear-workspace-filter" ${filter.isLoading ? 'disabled' : ''}>Turn off filter</button>` : ''}
        </div>
      </form>
    </section>`;
}

export function renderWorkspaceChatDocument(state: AppState): string {
  const chat = state.workspaceChat;
  if (!chat.open) return '';
  const embeddingsEnabled = state.aiSettings.embeddings.enabled;
  const canSend = embeddingsEnabled && !state.busy && (chat.isSending || chat.draft.trim().length > 0);
  return `
    <section class="workspace-chat-document" data-workspace-chat-document="true" aria-label="${escapeAttr(chat.targetDirectory ? 'Chat folder' : 'Chat workspace')}">
      ${embeddingsEnabled
      ? `<form class="workspace-chat-native" data-form="workspace-chat">
              <div class="workspace-chat-thread-shell">
                <div class="workspace-chat-thread" data-workspace-chat-scroll-container="true" role="log" aria-live="polite">
                  ${chat.messages.length === 0
        ? `<div class="workspace-chat-empty">
                        <strong>${escapeHtml(chat.targetDirectory ? 'Ask this folder' : 'Ask this workspace')}</strong>
                        <p>Questions use embeddings from HVY files in this scope.</p>
                      </div>`
        : chat.messages.map(renderWorkspaceChatMessage).join('')}
                </div>
                <button type="button" class="hvy-galaxy-button workspace-chat-scroll-bottom" data-action="workspace-chat-scroll-bottom" hidden>Latest ↓</button>
              </div>
              ${renderWorkspaceChatStatus(chat)}
              <label class="workspace-chat-composer">
                <span>Question</span>
                <textarea class="hvy-galaxy-textarea" data-field="workspace-chat-draft" rows="4" placeholder="${escapeAttr(chat.targetDirectory ? 'Ask about this folder...' : 'Ask about this workspace...')}" ${chat.isSending ? 'disabled' : ''}>${escapeHtml(chat.draft)}</textarea>
              </label>
              <div class="workspace-chat-actions">
                ${chat.isSending ? '<span>Working...</span>' : ''}
                <button type="submit" class="hvy-galaxy-button secondary" ${canSend ? '' : 'disabled'}>${chat.isSending ? 'Stop' : 'Send'}</button>
              </div>
            </form>`
      : `<div class="workspace-chat-required">
              <h3>Embeddings Required</h3>
              <p>Enable embeddings before chatting across folders or workspaces.</p>
              <button class="hvy-galaxy-button" type="button" data-action="ai-settings">Open AI Settings</button>
            </div>`
    }
    </section>`;
}

export function renderWorkspaceChatClosePrompt(state: AppState): string {
  const chat = state.workspaceChat;
  if (!chat.open || !chat.closePromptOpen) return '';
  return `
    <div class="modal-backdrop workspace-chat-save-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="workspaceChatSaveTitle">
        <h2 id="workspaceChatSaveTitle">Save Chat?</h2>
        <p>Save this chat session as an HVY document before closing it.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-close-workspace-chat">Cancel</button>
          <button class="hvy-galaxy-button" type="button" data-action="discard-workspace-chat">Don't Save</button>
          <button class="hvy-galaxy-button" type="button" data-action="save-workspace-chat" ${state.busy ? 'disabled' : ''}>Save Chat</button>
        </div>
      </section>
    </div>`;
}

export function renderWorkspaceChatMessage(message: AppState['workspaceChat']['messages'][number]): string {
  return `
    <article class="workspace-chat-message is-${escapeAttr(message.role)}${message.error ? ' is-error' : ''}">
      <div class="workspace-chat-message-role">${message.role === 'user' ? 'You' : 'Assistant'}</div>
      <div class="workspace-chat-message-body">${message.role === 'assistant' ? renderWorkspaceChatMarkdown(message.content) : renderPlainChatText(message.content)}</div>
    </article>`;
}

export function renderWorkspaceChatMarkdown(value: string): string {
  return markdownToReaderHtml(normalizeMarkdownLists(stripHvySerializationComments(value)), { crossDocumentLinksEnabled: true });
}

export function stripHvySerializationComments(value: string): string {
  return value.replace(/<!--\/?hvy:[\s\S]*?-->/g, '').trim();
}

export function renderPlainChatText(value: string): string {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function renderWorkspaceChatStatus(chat: AppState['workspaceChat']): string {
  const progress = chat.progress;
  const showProgress = Boolean(chat.isSending && progress && (progress.queued > 0 || progress.active > 0));
  if (!chat.status && !chat.error && !showProgress) return '';
  return `
    <section class="workspace-chat-status" aria-live="polite">
      ${chat.error ? `<p class="workspace-chat-error">${escapeHtml(chat.error)}</p>` : ''}
      ${chat.status ? `<p>${escapeHtml(chat.status)}</p>` : ''}
      ${showProgress && progress ? `<dl class="workspace-chat-progress" aria-label="Embedding progress">
        <div><dt>Files</dt><dd>${progress.completed}/${progress.completed + progress.active + progress.queued}</dd></div>
        <div><dt>Failed</dt><dd>${progress.failed}</dd></div>
      </dl>` : ''}
    </section>`;
}

export function workspaceFilterFolderName(targetDirectory: string): string {
  const parts = normalizeTreeRelativePath(targetDirectory).split('/').filter(Boolean);
  return parts.at(-1) ?? 'folder';
}

export function renderRenameFileDialog(state: AppState): string {
  if (!state.renameFilePath || !state.renameFileCurrentName) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="rename-file">
        <h2>Rename</h2>
        <label>
          <span>Name</span>
          <input class="hvy-galaxy-input" name="fileName" type="text" autocomplete="off" value="${escapeAttr(displayDocumentName(state.renameFileCurrentName))}" required>
        </label>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-rename-file">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Rename</button>
        </div>
      </form>
    </div>`;
}

export function renderRenameEncryptedFolderDialog(state: AppState): string {
  if (!state.renameEncryptedFolderWorkspacePath || !state.renameEncryptedFolderDirectory || !state.renameEncryptedFolderCurrentName) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="rename-encrypted-folder">
        <h2>Rename Encrypted Folder</h2>
        <p class="dialog-note">Only encrypted folder metadata changes. The opaque filesystem directory name remains the same.</p>
        <label>
          <span>Name</span>
          <input class="hvy-galaxy-input" name="folderName" type="text" autocomplete="off" value="${escapeAttr(state.renameEncryptedFolderCurrentName)}" required>
        </label>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-rename-encrypted-folder">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Rename</button>
        </div>
      </form>
    </div>`;
}

export function renderDeleteFileDialog(state: AppState): string {
  if (!state.deleteFilePath || !state.deleteFileName) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog delete-file-dialog" role="dialog" aria-modal="true" aria-labelledby="deleteFileTitle">
        <h2 id="deleteFileTitle">Delete forever?</h2>
        <p class="dialog-note">${escapeHtml(state.deleteFileName)} will be removed from disk.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-delete-file">Cancel</button>
          <button type="button" class="hvy-galaxy-button danger-button" data-action="delete-file" ${state.busy ? 'disabled' : ''}>Delete</button>
        </div>
      </section>
    </div>`;
}

export function renderDeleteFolderDialog(state: AppState): string {
  if (!state.deleteFolderWorkspacePath || !state.deleteFolderName || state.deleteFolderArchivedFiles.length === 0) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog delete-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="deleteFolderTitle">
        <h2 id="deleteFolderTitle">Delete archived files?</h2>
        <p class="dialog-note">${escapeHtml(state.deleteFolderName)} contains ${state.deleteFolderArchivedFiles.length} archived file${state.deleteFolderArchivedFiles.length === 1 ? '' : 's'} that will be removed from disk.</p>
        <div class="delete-folder-file-list" role="list" aria-label="Archived files in folder">
          ${state.deleteFolderArchivedFiles.map((file) => `<div role="listitem">${escapeHtml(file)}</div>`).join('')}
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-delete-folder">Cancel</button>
          <button type="button" class="hvy-galaxy-button danger-button" data-action="delete-folder" ${state.busy ? 'disabled' : ''}>Delete</button>
        </div>
      </section>
    </div>`;
}

export function renderNewFolderDialog(state: AppState): string {
  if (!state.newFolderWorkspacePath) return '';
  const workspace = state.workspaces.find((candidate) => candidate.path === state.newFolderWorkspacePath) ?? null;
  const parentTarget = normalizeTreeRelativePath(state.newFolderParentDirectory);
  const parentLabel = parentTarget
    ? workspaceFolderOptions(workspace?.files ?? []).find((folder) => normalizeTreeRelativePath(folder.relativePath) === parentTarget)?.label ?? state.newFolderParentDirectory
    : 'Workspace root';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-folder">
        <h2>${state.newFolderEncrypted ? 'New Encrypted Folder' : 'New Folder'}</h2>
        <input class="hvy-galaxy-input" name="workspacePath" type="hidden" value="${escapeAttr(state.newFolderWorkspacePath)}">
        <input class="hvy-galaxy-input" name="parentDirectory" type="hidden" value="${escapeAttr(state.newFolderParentDirectory)}">
        <input name="encrypted" type="hidden" value="${state.newFolderEncrypted ? 'true' : 'false'}">
        <p class="dialog-note">${escapeHtml(workspace?.manifest.name ?? 'Workspace')} / ${escapeHtml(parentLabel)}</p>
        <label>
          <span>Name</span>
          <input class="hvy-galaxy-input" name="folderName" type="text" autocomplete="off" required>
        </label>
        ${state.newFolderEncrypted ? '<p class="dialog-note">Names and documents placed in this folder will use one encryption key. The folder is stored on disk under an app-managed encrypted-folder ID.</p>' : ''}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-new-folder">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>`;
}

export function renderEncryptedAIAccessDialog(state: AppState): string {
  const prompt = state.encryptedAIAccessPrompt;
  if (!prompt) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog encrypted-ai-access-dialog" role="dialog" aria-modal="true" aria-labelledby="encryptedAIAccessTitle">
        <h2 id="encryptedAIAccessTitle">Enable AI Access?</h2>
        <p class="dialog-note">${escapeHtml(prompt.name)} is encrypted. AI features may send its decrypted content to your configured AI provider. The saved files remain encrypted, but content sent to a provider is governed by that provider’s security, retention, and privacy policies.</p>
        ${prompt.kind === 'folder' ? '<p class="dialog-note">This permission applies to documents in this folder and its encrypted subfolders unless a document is disabled separately.</p>' : ''}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-encrypted-ai-access">Cancel</button>
          <button class="hvy-galaxy-button" type="button" data-action="confirm-encrypted-ai-access" ${state.busy ? 'disabled' : ''}>Enable AI Access</button>
        </div>
      </section>
    </div>`;
}

export function renderWorkspaceTransferDialog(state: AppState): string {
  const transfer = state.workspaceTransfer;
  if (!transfer) return '';
  const workspaces = state.workspaces.filter((workspace) => workspace.path !== transfer.excludedWorkspacePath);
  const sourceWorkspacePath = transfer.sourcePath
    ? workspacePathForFileInWorkspaces(state.workspaces, transfer.sourcePath)
    : null;
  const preferredWorkspacePath = sourceWorkspacePath ?? state.selectedWorkspacePath;
  const selectedWorkspacePath = workspaces.some((workspace) => workspace.path === preferredWorkspacePath)
    ? preferredWorkspacePath
    : workspaces[0]?.path ?? null;
  const selectedTargetDirectory = selectedWorkspacePath === sourceWorkspacePath ? transfer.targetDirectory : '';
  const title = transfer.mode === 'saveCurrent'
    ? 'Save to Workspace'
    : transfer.mode === 'copyFile'
      ? 'Copy to Workspace'
      : 'Move to Workspace';
  const submitLabel = transfer.mode === 'moveFile' ? 'Move' : transfer.mode === 'copyFile' ? 'Copy' : 'Save';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog workspace-transfer-dialog" data-form="workspace-transfer">
        <h2>${escapeHtml(title)}</h2>
        ${renderWorkspaceDestinationTree(workspaces, selectedWorkspacePath, selectedTargetDirectory)}
        ${transfer.mode === 'saveCurrent' ? `
          <label>
            <span>Name</span>
            <input class="hvy-galaxy-input" name="fileName" type="text" autocomplete="off" value="${escapeAttr(transfer.nameDraft)}" required>
          </label>
        ` : ''}
        <p class="dialog-note">${escapeHtml(transfer.fileName)}</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-workspace-transfer">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy || workspaces.length === 0 ? 'disabled' : ''}>${escapeHtml(submitLabel)}</button>
        </div>
      </form>
    </div>`;
}

export function renderWorkspaceDestinationTree(workspaces: Workspace[], selectedWorkspacePath: string | null, selectedRelativePath: string): string {
  if (workspaces.length === 0) {
    return '<input class="hvy-galaxy-input" name="workspaceDestination" type="hidden" value="">';
  }
  return `
    <div class="workspace-destination-field">
      <span>Destination</span>
      <div class="workspace-destination-tree" role="radiogroup" aria-label="Destination">
        ${workspaces.map((workspace) => renderWorkspaceDestination(workspace, selectedWorkspacePath, selectedRelativePath)).join('')}
      </div>
    </div>`;
}

export function renderWorkspaceDestination(workspace: Workspace, selectedWorkspacePath: string | null, selectedRelativePath: string): string {
  const selectedRoot = workspace.path === selectedWorkspacePath && selectedRelativePath === '';
  const folders = workspace.files.map((node) => {
    if (node.kind !== 'folder') return '';
    return renderWorkspaceDestinationFolder(node, workspace.path, selectedWorkspacePath, selectedRelativePath);
  }).join('');
  return `
    <div class="workspace-destination-workspace">
      <label class="workspace-destination-option is-root">
        <input class="hvy-galaxy-input"
          type="radio"
          name="workspaceDestination"
          value="${escapeAttr(workspace.path)}"
          data-workspace-path="${escapeAttr(workspace.path)}"
          data-target-directory=""
          ${selectedRoot ? 'checked' : ''}
          required
        >
        <span>${escapeHtml(workspace.manifest.name)}</span>
      </label>
      ${folders ? `<div class="workspace-destination-children">${folders}</div>` : ''}
    </div>`;
}

export function renderWorkspaceDestinationFolder(
  node: Extract<WorkspaceTreeNode, { kind: 'folder' }>,
  workspacePath: string,
  selectedWorkspacePath: string | null,
  selectedRelativePath: string,
): string {
  const relativePath = workspaceNodeRelativePath(node);
  if (relativePath === 'templates' || relativePath.startsWith('templates/')) return '';
  const selected = workspacePath === selectedWorkspacePath && relativePath === selectedRelativePath;
  const children = Array.isArray(node.children)
    ? node.children.map((child) => {
      if (child.kind !== 'folder') return '';
      return renderWorkspaceDestinationFolder(child, workspacePath, selectedWorkspacePath, selectedRelativePath);
    }).join('')
    : '';
  return `
    <div class="workspace-destination-folder">
      <label class="workspace-destination-option">
        <input class="hvy-galaxy-input"
          type="radio"
          name="workspaceDestination"
          value="${escapeAttr(`${workspacePath}::${relativePath}`)}"
          data-workspace-path="${escapeAttr(workspacePath)}"
          data-target-directory="${escapeAttr(relativePath)}"
          ${selected ? 'checked' : ''}
          required
        >
        <span>${escapeHtml(workspaceNodeName(node))}</span>
      </label>
      ${children ? `<div class="workspace-destination-children">${children}</div>` : ''}
    </div>`;
}

export function renderWorkspaceFolderSelect(workspace: Workspace, selectedRelativePath: string): string {
  const folders = workspaceFolderOptions(workspace.files);
  if (folders.length === 0) {
    return '<input class="hvy-galaxy-input" name="targetDirectory" type="hidden" value="">';
  }
  return `
    <label>
      <span>Folder</span>
      <select class="hvy-galaxy-select" name="targetDirectory">
        <option value="">Workspace root</option>
        ${folders.map((folder) => `<option value="${escapeAttr(folder.relativePath)}" ${folder.relativePath === selectedRelativePath ? 'selected' : ''}>${escapeHtml(folder.label)}</option>`).join('')}
      </select>
    </label>`;
}

export function workspaceFolderOptions(nodes: WorkspaceTreeNode[], prefix = ''): Array<{ relativePath: string; label: string }> {
  const options: Array<{ relativePath: string; label: string }> = [];
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    const relativePath = workspaceNodeRelativePath(node);
    if (relativePath === 'templates' || relativePath.startsWith('templates/')) continue;
    const name = workspaceNodeName(node);
    const label = prefix ? `${prefix} / ${name}` : name;
    options.push({ relativePath, label });
    options.push(...workspaceFolderOptions(node.children, label));
  }
  return options;
}

export function workspaceNodeRelativePath(node: WorkspaceTreeNode): string {
  if (typeof node.relativePath === 'string') return node.relativePath;
  const snakeCaseNode = node as WorkspaceTreeNode & { relative_path?: unknown };
  return typeof snakeCaseNode.relative_path === 'string' ? snakeCaseNode.relative_path : '';
}

export function workspaceNodeName(node: WorkspaceTreeNode): string {
  if (typeof node.name === 'string') return node.name;
  return '';
}

export function renderSaveAsDialog(state: AppState): string {
  if (!state.saveAsDialogOpen || !state.document) return '';
  const templateDisabled = state.document.source.extension === '.md' || state.document.virtual === 'versionHistory';
  if (state.saveAsKind === 'template' && !templateDisabled) {
    return renderSaveAsTemplateDialog(state);
  }
  const workspaces = state.workspaces;
  const workspaceDisabled = workspaces.length === 0;
  const workspaceActive = state.saveAsScope === 'workspace' && !workspaceDisabled;
  const anywhereActive = state.saveAsScope === 'anywhere' || workspaceDisabled;
  const selectedWorkspacePath = workspaces.some((workspace) => workspace.path === state.selectedWorkspacePath)
    ? state.selectedWorkspacePath
    : currentDocumentWorkspacePath(state) ?? workspaces[0]?.path ?? null;
  const selectedWorkspace = workspaces.find((workspace) => workspace.path === selectedWorkspacePath) ?? null;
  const name = state.document.virtual === 'versionHistory'
    ? displayDocumentName(savedVersionDocumentName(state.document.historySourceName ?? state.document.source.name))
    : displayDocumentName(state.document.source.name);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="save-as-document">
        <h2>Save As...</h2>
        ${renderSaveAsKindControl('document', templateDisabled)}
        <div class="segmented-control" role="tablist" aria-label="Save destination">
          <button type="button" class="hvy-galaxy-button ${workspaceActive ? 'is-active' : ''}" data-action="set-save-as-scope" data-scope="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace</button>
          <button type="button" class="hvy-galaxy-button ${anywhereActive ? 'is-active' : ''}" data-action="set-save-as-scope" data-scope="anywhere" aria-pressed="${anywhereActive ? 'true' : 'false'}">Anywhere</button>
        </div>
        <input class="hvy-galaxy-input" name="scope" type="hidden" value="${escapeAttr(anywhereActive ? 'anywhere' : 'workspace')}">
        ${workspaceActive ? `
          <label>
            <span>Workspace</span>
            <select class="hvy-galaxy-select" name="workspacePath" required>
              ${workspaces.map((workspace) => `<option value="${escapeAttr(workspace.path)}" ${workspace.path === selectedWorkspacePath ? 'selected' : ''}>${escapeHtml(workspace.manifest.name)}</option>`).join('')}
            </select>
          </label>
          ${selectedWorkspace ? renderWorkspaceFolderSelect(selectedWorkspace, '') : ''}
          <label>
            <span>Name</span>
            <input class="hvy-galaxy-input" name="fileName" type="text" autocomplete="off" value="${escapeAttr(name)}" required>
          </label>
        ` : `
          <p class="dialog-note">Choose a location outside HVY Galaxy.</p>
        `}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-save-as">Cancel</button>
          ${workspaceActive
      ? `<button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Save</button>`
      : `<button class="hvy-galaxy-button" type="button" data-action="save-as-anywhere" ${state.busy ? 'disabled' : ''}>Choose Location</button>`}
        </div>
      </form>
    </div>`;
}

export function renderSaveAsTemplateDialog(state: AppState): string {
  const workspaceDisabled = !currentDocumentWorkspacePath(state);
  const appActive = state.saveTemplateScope === 'app';
  const workspaceActive = state.saveTemplateScope === 'workspace' && !workspaceDisabled;
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="save-as-template">
        <h2>Save As...</h2>
        ${renderSaveAsKindControl('template', false)}
        <label>
          <span>Format</span>
          <select class="hvy-galaxy-select" name="format">
            <option value=".thvy" ${state.document?.source.extension === '.phvy' ? '' : 'selected'}>THVY template (.thvy)</option>
            <option value=".phvy" ${state.document?.source.extension === '.phvy' ? 'selected' : ''}>PHVY template (.phvy)</option>
          </select>
        </label>
        <label>
          <span>Name</span>
          <input class="hvy-galaxy-input" name="templateName" type="text" autocomplete="off" value="${escapeAttr(state.document?.source.name.replace(/\.(t?hvy|phvy|md)$/i, '') ?? '')}" autofocus required>
        </label>
        <div class="field-group">
          <span>Scope</span>
          <div class="segmented-control">
            <button type="button" class="hvy-galaxy-button ${appActive ? 'is-active' : ''}" data-action="set-save-template-scope" data-scope="app" aria-pressed="${appActive ? 'true' : 'false'}">App</button>
            <button type="button" class="hvy-galaxy-button ${workspaceActive ? 'is-active' : ''}" data-action="set-save-template-scope" data-scope="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace</button>
          </div>
        </div>
        <input class="hvy-galaxy-input" name="scope" type="hidden" value="${escapeAttr(workspaceActive ? 'workspace' : 'app')}">
        <p class="dialog-note">${workspaceDisabled ? 'Templates can be saved to app templates. Workspace templates are available when the document belongs to an open workspace.' : 'App templates are available everywhere; workspace templates stay with this workspace.'}</p>
        ${state.error ? `<p class="dialog-note" data-state="error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-save-as">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

export function renderSaveAsKindControl(activeKind: AppState['saveAsKind'], templateDisabled: boolean): string {
  return `
    <div class="segmented-control" role="tablist" aria-label="Save as type">
      <button type="button" class="hvy-galaxy-button ${activeKind === 'document' ? 'is-active' : ''}" data-action="set-save-as-kind" data-kind="document" aria-pressed="${activeKind === 'document' ? 'true' : 'false'}">Document</button>
      <button type="button" class="hvy-galaxy-button ${activeKind === 'template' ? 'is-active' : ''}" data-action="set-save-as-kind" data-kind="template" aria-pressed="${activeKind === 'template' ? 'true' : 'false'}" ${templateDisabled ? 'disabled' : ''}>Template</button>
    </div>`;
}

export function renderWorkspaceFilterModeButton(mode: HvyDocumentSearchMode, label: string, filter: WorkspaceFilterState, disabled = false): string {
  const active = filter.mode === mode;
  const icon = mode === 'keyword' ? gearIcon() : sparklesIcon();
  return `
    <button
      type="button"
      class="hvy-galaxy-button search-tab${active ? ' is-active' : ''}"
      data-action="set-workspace-filter-mode"
      data-filter-mode="${escapeAttr(mode)}"
      aria-pressed="${active ? 'true' : 'false'}"
      ${disabled ? 'disabled title="Enable embeddings in AI settings"' : ''}
    >${icon}<span>${escapeHtml(label)}</span></button>`;
}

export function workspaceFilterModeDescription(mode: HvyDocumentSearchMode): string {
  if (mode === 'semantic') return 'Use AI to evaluate matches. Slower.';
  if (mode === 'embedding') return 'Use embeddings to speed up semantic search. Faster, but may create false negatives.';
  return 'Use keyword matching';
}

export function renderWorkspaceFilterBehaviorButton(mode: SearchFilterMode, label: string, filter: WorkspaceFilterState): string {
  const active = filter.filterMode === mode;
  return `
    <button
      type="button"
      class="hvy-galaxy-button search-filter-mode-button${active ? ' is-active' : ''}"
      data-action="set-workspace-filter-behavior"
      data-filter-behavior="${escapeAttr(mode)}"
      aria-pressed="${active ? 'true' : 'false'}"
    >${escapeHtml(label)}</button>`;
}

export function renderWorkspaceFilterVisibilityControls(
  visibility: WorkspaceTemplateVisibility,
  disabled: boolean,
  workspacePath: string,
  embeddingPreview: AppState['workspaceEmbeddingPreviews'][string] | null,
): string {
  const previewEnabled = embeddingPreview?.enabled === true;
  return `
    <div class="search-filter-box">
      <div class="search-filter-box-head">
        ${eyeIcon()}
        <span>File Visibility</span>
      </div>
      <div class="workspace-filter-visibility-list">
        <label class="checkbox-row">
          <input class="hvy-galaxy-input" type="checkbox" name="hvyDocuments" ${visibility.hvyDocuments ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>HVY</span>
        </label>
        <label class="checkbox-row">
          <input class="hvy-galaxy-input" type="checkbox" name="thvyTemplates" ${visibility.thvyTemplates ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>THVY</span>
        </label>
        <label class="checkbox-row">
          <input class="hvy-galaxy-input" type="checkbox" name="phvyTemplates" ${visibility.phvyTemplates ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>PHVY</span>
        </label>
        <label class="checkbox-row">
          <input class="hvy-galaxy-input" type="checkbox" name="archivedFiles" ${visibility.archivedFiles ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>Archived</span>
        </label>
        <label class="checkbox-row">
          <input class="hvy-galaxy-input" type="checkbox" data-action="toggle-workspace-embedding-preview" data-workspace-path="${escapeAttr(workspacePath)}" ${previewEnabled ? 'checked' : ''} ${disabled || !workspacePath ? 'disabled' : ''}>
          <span>Embeddings</span>
        </label>
      </div>
      ${previewEnabled && !embeddingPreview?.loading ? `<div class="workspace-embedding-preview-inline">${escapeHtml(embeddingPreview?.error ?? 'Embedding files are visible in the workspace tree.')}</div>` : ''}
    </div>`;
}

export function readWorkspaceTemplateVisibilityForm(data: FormData): WorkspaceTemplateVisibility {
  return {
    hvyDocuments: data.has('hvyDocuments'),
    thvyTemplates: data.has('thvyTemplates'),
    phvyTemplates: data.has('phvyTemplates'),
    archivedFiles: data.has('archivedFiles'),
  };
}
