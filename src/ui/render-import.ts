import {
  parseTags,
  renderTagEditor,
  serializeTags
} from '../../../heavy-file-format/src/editor/tag-editor';
import { deserializeDocumentBytes } from '../../../heavy-file-format/src/serialization';
import appIconUrl from '../../src-tauri/icons/Square310x310Logo.png';
import { type DocumentCreationType, type DocumentExtension, type WorkspaceFileNode, type WorkspaceTemplateVisibility, type WorkspaceTreeNode } from '../backend';
import { currentDocumentWorkspacePath } from '../fileActions';
import type { VisualDocument } from '../hvy';
import { type AppState } from '../state';
import { mergeSavedTemplates, templatesForDocumentType, workspaceTemplateVisibility } from '../templates';
import { MIN_PASTED_IMPORT_CHARS } from './core';
import { revealMenuLabel } from './events-workspace';
import { renderWorkspaceFolderSelect } from './render-workspace-dialogs';
import { displayDocumentName } from './render-workspaces';
import { escapeAttr, escapeHtml } from './shared';

export function renderNewDocumentDialog(state: AppState): string {
  if (!state.newDocumentWorkspacePath) {
    return '';
  }
  const workspace = state.workspaces.find((candidate) => candidate.path === state.newDocumentWorkspacePath) ?? null;
  const visibility = workspaceTemplateVisibility(workspace);
  const templates = templatesForDocumentType(mergeSavedTemplates(state.savedTemplates), state.newDocumentType, visibility);
  const showTemplatePicker = state.newDocumentType === 'hvy';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog" data-form="new-document">
        <h2>New Document</h2>
        ${renderDocumentTypeControl('new', state.newDocumentType, visibility)}
        ${workspace ? renderWorkspaceFolderSelect(workspace, state.newDocumentDirectory) : ''}
        <label>
          <span>Name</span>
          <input class="hvy-galaxy-input" name="documentName" type="text" autocomplete="off" autofocus required>
        </label>
        ${showTemplatePicker ? `<label>
          <span>Template</span>
          <select class="hvy-galaxy-select" name="templateId">
            ${templates.map(renderTemplateOption).join('')}
          </select>
        </label>` : ''}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-new-document">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>`;
}

export function renderImportDialog(state: AppState): string {
  const workspacePath = state.importWorkspacePath;
  const importCurrent = state.importIntoCurrentDialogOpen;
  if (!workspacePath && !importCurrent) {
    return '';
  }
  const currentWorkspacePath = importCurrent ? currentDocumentWorkspacePath(state) : workspacePath;
  const workspace = state.workspaces.find((candidate) => candidate.path === currentWorkspacePath) ?? null;
  const visibility = workspaceTemplateVisibility(workspace);
  const templates = templatesForDocumentType(mergeSavedTemplates(state.savedTemplates), state.importDocumentType, visibility);
  const showTemplatePicker = state.importDocumentType === 'hvy';
  const source = state.importSource;
  const title = importCurrent ? 'Import Into Current' : 'Import Document';
  const baseDisabled = state.busy || (!importCurrent && showTemplatePicker && templates.length === 0);
  const hasValidSource = Boolean(source) || state.importSourceTextDraft.trim().length >= MIN_PASTED_IMPORT_CHARS;
  const sourceControls = importCurrent
    ? renderImportCurrentSourceControls(state, workspace)
    : renderAnywhereImportSourceControls(source, state.importSourceTextDraft);
  const outputControls = importCurrent ? renderImportCurrentOutputControls(state, workspace) : '';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="${importCurrent ? 'import-current' : 'import-document'}">
        <h2>${escapeHtml(title)}</h2>
        ${importCurrent ? '<p class="dialog-note">Uses the current file as an import template, and saves the result to the output file.</p>' : ''}
        ${importCurrent ? '' : `
          ${renderDocumentTypeControl('import', state.importDocumentType, visibility)}
          ${workspace ? renderWorkspaceFolderSelect(workspace, state.importDirectory) : ''}
          <label>
            <span>Name</span>
            <input class="hvy-galaxy-input" name="documentName" type="text" autocomplete="off" autofocus required>
          </label>
          ${showTemplatePicker ? `<label>
            <span>Template</span>
            <select class="hvy-galaxy-select" name="templateId">
              ${templates.map(renderTemplateOption).join('')}
            </select>
          </label>` : ''}
        `}
        <div class="field-group">
          <span>Source</span>
          ${sourceControls}
        </div>
        ${outputControls}
        <label>
          <span>Instructions</span>
          <textarea class="hvy-galaxy-textarea" name="instructions" rows="4" placeholder="Optional import guidance"></textarea>
        </label>
        ${renderImportOptions(state)}
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-import">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" data-role="import-submit" data-has-file-source="${source ? 'true' : 'false'}" data-base-disabled="${baseDisabled ? 'true' : 'false'}" ${baseDisabled || !hasValidSource ? 'disabled' : ''}>Import</button>
        </div>
      </form>
    </div>`;
}

export function renderImportCurrentOutputControls(state: AppState, workspace: AppState['workspaces'][number] | null): string {
  const workspaceDisabled = !workspace;
  const workspaceActive = state.importOutputMode === 'workspace' && !workspaceDisabled;
  const currentActive = state.importOutputMode === 'current' || workspaceDisabled;
  const outputName = suggestedImportOutputName(state, workspace);
  return `
    <div class="field-group">
      <span>Output</span>
      <div class="segmented-control" role="tablist" aria-label="Import output">
        <button type="button" class="hvy-galaxy-button ${workspaceActive ? 'is-active' : ''}" data-action="set-import-output-mode" data-mode="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace File</button>
        <button type="button" class="hvy-galaxy-button ${currentActive ? 'is-active' : ''}" data-action="set-import-output-mode" data-mode="current" aria-pressed="${currentActive ? 'true' : 'false'}">Current File</button>
      </div>
      <input class="hvy-galaxy-input" name="importOutputMode" type="hidden" value="${escapeAttr(workspaceActive ? 'workspace' : 'current')}">
      ${workspaceActive ? `
        <label>
          <span>Name</span>
          <input class="hvy-galaxy-input" name="importOutputName" type="text" autocomplete="off" value="${escapeAttr(outputName)}" required>
        </label>
      ` : ''}
    </div>`;
}

export function renderImportOptions(state: AppState): string {
  const tagField = shouldShowImportExcludeTagsField(state)
    ? renderImportExcludeTagsField(state.importExcludeTags, collectImportSourceTagSuggestions(state.importSource))
    : '<input class="hvy-galaxy-input" name="excludeTags" type="hidden" value="">';
  return `
    ${tagField}
    <label class="checkbox-row">
      <input class="hvy-galaxy-input" name="newSectionsOnly" type="checkbox" ${state.importNewSectionsOnly ? 'checked' : ''}>
      <span>Only import new sections</span>
    </label>`;
}

export function renderImportExcludeTagsField(value: string, suggestions: string[]): string {
  return `
    <label class="import-exclude-tags-field">
      <span>Filter out tags</span>
      ${renderTagEditor('search-exclude-tags', value, { placeholder: 'Add tag to filter out' }, { escapeAttr, escapeHtml })}
      <input class="hvy-galaxy-input" name="excludeTags" type="hidden" value="${escapeAttr(serializeTags(parseTags(value)))}">
      ${suggestions.length > 0 ? `
        <div class="import-exclude-tag-suggestions" data-role="import-exclude-tag-suggestions" hidden>
          ${suggestions.map((tag) => `<button class="hvy-galaxy-button" type="button" data-action="add-import-exclude-tag" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`).join('')}
        </div>
      ` : ''}
    </label>`;
}

export function shouldShowImportExcludeTagsField(state: AppState): boolean {
  return Boolean(state.importSource?.bytes && isImportSourceDocumentExtension(state.importSource.extension));
}

export function collectImportSourceTagSuggestions(source: AppState['importSource']): string[] {
  if (!source?.bytes || !isImportSourceDocumentExtension(source.extension)) {
    return [];
  }
  return collectDocumentTags(deserializeDocumentBytes(new Uint8Array(source.bytes), source.extension));
}

export function isImportSourceDocumentExtension(extension: NonNullable<AppState['importSource']>['extension']): extension is DocumentExtension {
  return extension === '.hvy' || extension === '.thvy' || extension === '.phvy' || extension === '.md';
}

export function collectDocumentTags(document: VisualDocument): string[] {
  const tags = new Map<string, string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    Object.entries(item as Record<string, unknown>).forEach(([key, child]) => {
      if (key === 'tags' && typeof child === 'string') {
        parseTagSuggestions(child).forEach((tag) => tags.set(tag.toLowerCase(), tag));
      } else {
        visit(child);
      }
    });
  };
  visit(document.meta);
  visit(document.sections);
  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

export function parseTagSuggestions(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag || seen.has(tag.toLowerCase())) {
        return false;
      }
      seen.add(tag.toLowerCase());
      return true;
    });
}

export function suggestedImportOutputName(state: AppState, workspace: AppState['workspaces'][number] | null): string {
  const base = `${displayDocumentName(state.document?.source.name ?? 'Imported')} import`;
  if (!workspace || !state.document) {
    return base;
  }
  const extension = importOutputExtension(state.document.source.extension);
  const existing = new Set(workspace.files
    .filter((node): node is Extract<WorkspaceTreeNode, { kind: 'file' }> => node.kind === 'file')
    .map((node) => node.name.toLowerCase()));
  if (!existing.has(`${base}${extension}`.toLowerCase())) {
    return base;
  }
  let index = 1;
  while (existing.has(`${base} (${index})${extension}`.toLowerCase())) {
    index += 1;
  }
  return `${base} (${index})`;
}

export function importOutputExtension(extension: NonNullable<AppState['document']>['source']['extension']): '.hvy' | '.phvy' {
  return extension === '.phvy' ? '.phvy' : '.hvy';
}

export function renderImportProgressDialog(state: AppState): string {
  if (!state.importProgressDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="Import progress">
        <h2>Importing</h2>
        <p class="dialog-note">${escapeHtml(state.status || 'Importing...')}</p>
      </section>
    </div>`;
}

export function renderImportCurrentSourceControls(state: AppState, workspace: AppState['workspaces'][number] | null): string {
  const workspaceFiles = workspace ? sortedWorkspaceHvySourceFiles(workspace.files) : [];
  const workspaceDisabled = workspaceFiles.length === 0;
  const workspaceActive = state.importSourceTab === 'workspace' && !workspaceDisabled;
  const anywhereActive = state.importSourceTab === 'anywhere' || workspaceDisabled;
  return `
    <div class="segmented-control import-source-tabs" role="tablist" aria-label="Import source">
      <button type="button" class="hvy-galaxy-button ${workspaceActive ? 'is-active' : ''}" data-action="set-import-source-tab" data-tab="workspace" aria-pressed="${workspaceActive ? 'true' : 'false'}" ${workspaceDisabled ? 'disabled' : ''}>Workspace</button>
      <button type="button" class="hvy-galaxy-button ${anywhereActive ? 'is-active' : ''}" data-action="set-import-source-tab" data-tab="anywhere" aria-pressed="${anywhereActive ? 'true' : 'false'}">Anywhere</button>
    </div>
    ${workspaceActive ? renderImportCurrentWorkspaceSourcePicker(state, workspaceFiles) : renderAnywhereImportSourceControls(state.importSource, state.importSourceTextDraft)}
  `;
}

export function renderAnywhereImportSourceControls(source: AppState['importSource'], sourceTextDraft = ''): string {
  const sourceText = sourceTextDraft || (source?.extension === '.pdf' || source?.extension === '.docx' ? source.text ?? '' : '');
  const sourceNote = source
    ? 'Using selected file unless pasted text is provided.'
    : sourceText.trim().length > 0
      ? `${Math.min(sourceText.trim().length, MIN_PASTED_IMPORT_CHARS)}/${MIN_PASTED_IMPORT_CHARS} characters.`
      : 'Choose a file or paste at least 50 characters.';
  return `
    <div class="source-picker-row">
      <button class="hvy-galaxy-button" type="button" data-action="choose-import-source">Choose file</button>
      <span>${source ? escapeHtml(source.name) : 'No source selected'}</span>
    </div>
    <textarea name="importSourceText" class="hvy-galaxy-textarea import-source-textarea" data-field="import-source-text" rows="8" placeholder="Or paste at least 50 characters of source text here">${escapeHtml(sourceText)}</textarea>
    <p class="dialog-note" data-role="import-source-note">${escapeHtml(sourceNote)}</p>`;
}

export function renderImportCurrentWorkspaceSourcePicker(state: AppState, options: WorkspaceFileNode[]): string {
  return `
    <label>
      <span>Workspace HVY</span>
      <select class="hvy-galaxy-select" data-field="import-workspace-source">
        <option value="">Choose from current workspace</option>
        ${options.map((file) => `
          <option value="${escapeAttr(file.path)}" ${state.importSource?.path === file.path ? 'selected' : ''}>${escapeHtml(workspaceSourceLabel(file))}</option>
        `).join('')}
      </select>
    </label>`;
}

export function sortedWorkspaceHvySourceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return flattenWorkspaceHvySourceFiles(nodes)
    .sort((left, right) => workspaceSourceSortKey(left).localeCompare(workspaceSourceSortKey(right)));
}

export function workspaceSourceLabel(file: WorkspaceFileNode): string {
  return file.relativePath || file.name;
}

export function workspaceSourceSortKey(file: WorkspaceFileNode): string {
  return workspaceSourceLabel(file).toLocaleLowerCase();
}

export function flattenWorkspaceHvySourceFiles(nodes: WorkspaceTreeNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'folder') {
      return flattenWorkspaceHvySourceFiles(node.children);
    }
    return node.extension === '.hvy' ? [node] : [];
  });
}

export function renderDocumentTypeControl(
  context: 'new' | 'import',
  activeType: DocumentCreationType,
  visibility: WorkspaceTemplateVisibility,
): string {
  const action = context === 'new' ? 'set-new-document-type' : 'set-import-document-type';
  const hvyDisabled = !visibility.thvyTemplates;
  const thvyDisabled = !visibility.thvyTemplates;
  const phvyDisabled = !visibility.phvyTemplates;
  return `
    <div class="field-group">
      <span>Document Type</span>
      <div class="segmented-control document-type-control">
        <button type="button" class="hvy-galaxy-button ${activeType === 'hvy' ? 'is-active' : ''}" data-action="${action}" data-document-type="hvy" aria-pressed="${activeType === 'hvy' ? 'true' : 'false'}" ${hvyDisabled ? 'disabled' : ''}>HVY</button>
        <button type="button" class="hvy-galaxy-button ${activeType === 'thvy' ? 'is-active' : ''}" data-action="${action}" data-document-type="thvy" aria-pressed="${activeType === 'thvy' ? 'true' : 'false'}" ${thvyDisabled ? 'disabled' : ''}>THVY</button>
        <button type="button" class="hvy-galaxy-button ${activeType === 'phvy' ? 'is-active' : ''}" data-action="${action}" data-document-type="phvy" aria-pressed="${activeType === 'phvy' ? 'true' : 'false'}" ${phvyDisabled ? 'disabled' : ''}>PHVY</button>
      </div>
    </div>`;
}

export function updateImportSubmit(form: HTMLFormElement): void {
  const submit = form.querySelector<HTMLButtonElement>('[data-role="import-submit"]');
  if (!submit) return;
  const pastedLength = form.querySelector<HTMLTextAreaElement>('[data-field="import-source-text"]')?.value.trim().length ?? 0;
  const hasFileSource = submit.dataset.hasFileSource === 'true';
  const baseDisabled = submit.dataset.baseDisabled === 'true';
  const hasValidSource = hasFileSource || pastedLength >= MIN_PASTED_IMPORT_CHARS;
  submit.disabled = baseDisabled || !hasValidSource;
  const note = form.querySelector<HTMLElement>('[data-role="import-source-note"]');
  if (note) {
    note.textContent = hasFileSource
      ? pastedLength > 0 && pastedLength < MIN_PASTED_IMPORT_CHARS
        ? `Pasted text needs ${MIN_PASTED_IMPORT_CHARS} characters to replace the selected file.`
        : 'Using selected file unless pasted text is provided.'
      : pastedLength > 0
        ? `${Math.min(pastedLength, MIN_PASTED_IMPORT_CHARS)}/${MIN_PASTED_IMPORT_CHARS} characters.`
        : `Choose a file or paste at least ${MIN_PASTED_IMPORT_CHARS} characters.`;
    note.dataset.state = !hasValidSource && pastedLength > 0 ? 'error' : 'neutral';
  }
}

export function renderExportPdfSavePrompt(state: AppState): string {
  if (!state.exportPdfSavePromptOpen || !state.document) return '';
  const saveLabel = state.document.isNew ? 'Save As' : 'Save';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="Save before PDF export">
        <h2>Export PDF</h2>
        <p class="dialog-note">Save ${escapeHtml(state.document.source.name)} before exporting it to PDF.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-export-pdf-save-prompt">Cancel</button>
          <button class="hvy-galaxy-button" type="button" data-action="save-before-export-pdf" ${state.busy ? 'disabled' : ''}>${saveLabel}</button>
        </div>
      </section>
    </div>`;
}

export function renderExportedPdfDialog(state: AppState): string {
  if (!state.exportedPdfPath) return '';
  const name = state.exportedPdfPath.split(/[\\/]/).filter(Boolean).pop() ?? 'PDF';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="PDF exported">
        <h2>PDF Exported</h2>
        <p class="dialog-note">${escapeHtml(name)}</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="open-exported-pdf">Open</button>
          <button class="hvy-galaxy-button" type="button" data-action="reveal-exported-pdf">${escapeHtml(revealMenuLabel())}</button>
          <button class="hvy-galaxy-button" type="button" data-action="close-exported-pdf-dialog">Done</button>
        </div>
      </section>
    </div>`;
}

export function renderTemplateOption(template: ReturnType<typeof mergeSavedTemplates>[number]): string {
  const name = isBlankBundledTemplate(template) ? 'None' : template.name;
  const label = template.scope === 'bundled' ? name : `${name} (${template.scope})`;
  return `<option value="${escapeAttr(template.id)}">${escapeHtml(label)}</option>`;
}

export function isBlankBundledTemplate(template: ReturnType<typeof mergeSavedTemplates>[number]): boolean {
  return template.scope === 'bundled' && /^blank\.(thvy|phvy)$/i.test(template.fileName);
}

export function renderAboutDialog(state: AppState): string {
  if (!state.aboutDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="aboutTitle">
        <img class="about-logo" src="${escapeAttr(appIconUrl)}" alt="" aria-hidden="true">
        <h2 id="aboutTitle">HVY Galaxy</h2>
        <p class="about-version">Version ${escapeHtml(__APP_VERSION__)}</p>
        <p class="about-copy">Desktop app for HVY files</p>
        <div class="about-attribution">
          <span>Created by Heavy Resume</span>
          <a href="https://heavyresume.com" target="_blank" rel="noreferrer">https://heavyresume.com</a>
        </div>
        <div class="dialog-actions about-actions">
          <button class="hvy-galaxy-button" type="button" data-action="close-about">OK</button>
        </div>
      </section>
    </div>`;
}
