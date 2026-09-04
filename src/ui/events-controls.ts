import {
  commitTagEditorDraft,
  handleTagEditorInput,
  handleTagEditorKeydown,
  parseTags,
  serializeTags
} from '../../../heavy-file-format/src/editor/tag-editor';
import { colorValueToPickerHex, mergeAlphaIntoCssColor, mergePickerHexIntoCssColor } from '../colorTheme';
import { applyInspectionPrivacyRules } from '../integrationRegistry';
import { type AppState } from '../state';
import { workspaceDropTargetFromElement } from '../workspaceDropTarget';
import { hasDraggedFiles, hasDraggedWorkspaceFile, setDragOverTarget, workspaceDropTargetFromEvent } from './events-workspace';
import { readAiSettingsForm, readAppSettingsForm, readDebugLogSettingsControls, syncAiActionModelForProvider, syncAiEmbeddingCustomModelInput, syncAiEmbeddingModelForProvider, syncAiMaxContextCharsOutput, updateMcpConnectionPreview, updateMcpUrlPreview } from './render-ai-mcp';
import { updateImportSubmit } from './render-import';
import { applyThemeFilter, syncThemeAlphaControl, syncThemeOverrideAction } from './render-theme';
import { readWorkspaceTemplateVisibilityForm } from './render-workspace-dialogs';
import { updateNewWorkspaceSubmit, updateWorkspaceFilterSubmit } from './render-workspaces';
import { UiHandlers } from './types';

export const importExcludeTagHelpers = {
  getTagState(target: HTMLElement): string[] {
    return parseTags(importExcludeTagsInput(target)?.value ?? '');
  },
  setTagState(target: HTMLElement, tags: string[]): void {
    const input = importExcludeTagsInput(target);
    if (input) input.value = serializeTags(tags);
  },
  getRenderOptions() {
    return {};
  },
};

export function importExcludeTagsInput(target: HTMLElement): HTMLInputElement | null {
  const form = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
  return form?.querySelector<HTMLInputElement>('input[name="excludeTags"]') ?? null;
}

export function commitImportTagEditorDrafts(form: HTMLFormElement, handlers?: UiHandlers): void {
  form.querySelectorAll<HTMLInputElement>('[data-field="search-exclude-tags-input"]').forEach((input) => {
    commitTagEditorDraft(input, importExcludeTagHelpers);
    if (handlers) syncImportExcludeTagsState(input, handlers);
  });
}

export function syncImportExcludeTagsState(target: HTMLElement, handlers: UiHandlers): void {
  const input = importExcludeTagsInput(target);
  if (input) handlers.updateImportExcludeTags(input.value);
}

export function addImportExcludeTagSuggestion(target: HTMLElement, handlers: UiHandlers): void {
  const tag = target.dataset.tag ?? '';
  const field = target.closest<HTMLElement>('.import-exclude-tags-field');
  const input = field?.querySelector<HTMLInputElement>('[data-field="search-exclude-tags-input"]');
  if (!tag || !input) return;
  input.value = `${tag},`;
  handleTagEditorInput(input, importExcludeTagHelpers);
  syncImportExcludeTagsState(input, handlers);
  updateImportExcludeTagAutocomplete(input);
  input.focus();
}

export function updateImportExcludeTagAutocomplete(target: HTMLElement): void {
  const field = target.closest<HTMLElement>('.import-exclude-tags-field');
  const input = field?.querySelector<HTMLInputElement>('[data-field="search-exclude-tags-input"]');
  const menu = field?.querySelector<HTMLElement>('[data-role="import-exclude-tag-suggestions"]');
  if (!field || !input || !menu) return;

  const draft = input.value.trim().toLowerCase();
  const selected = new Set(parseTags(importExcludeTagsInput(input)?.value ?? '').map((tag) => tag.toLowerCase()));
  let visibleCount = 0;
  menu.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((button) => {
    const tag = button.dataset.tag ?? '';
    const visible = draft.length > 0 && tag.toLowerCase().includes(draft) && !selected.has(tag.toLowerCase());
    button.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  menu.hidden = visibleCount === 0;
}

export function bindControlEvents(root: HTMLElement, handlers: UiHandlers, state: AppState, signal: AbortSignal): void {
  root.addEventListener('change', (event) => {
    const input = event.target instanceof HTMLInputElement && event.target.matches('input[data-plugin-file-picker]')
      ? event.target
      : null;
    if (!input?.files?.length) return;
    const form = input.closest<HTMLFormElement>('form[data-form="app-settings"]');
    handlers.installPluginFiles(
      Array.from(input.files),
      readAppSettingsForm(new FormData(form!), state.document?.source.path ?? ''),
    );
    input.value = '';
  }, { signal });
  root.addEventListener('input', (event) => {
    const encryptionKeyLabel = event.target instanceof HTMLInputElement && event.target.dataset.action === 'set-document-encryption-key-label'
      ? event.target
      : null;
    if (encryptionKeyLabel) {
      handlers.setDocumentEncryptionKeyLabel(encryptionKeyLabel.value);
      return;
    }
    const input = event.target instanceof HTMLInputElement && event.target.name === 'privacyLabel' ? event.target : null;
    const row = input?.closest<HTMLElement>('[data-privacy-path]');
    const path = row?.dataset.privacyPath;
    if (input && row && path) {
      handlers.updateInspectionPrivacyLabel(path, input.value);
      row.classList.toggle('is-label', Boolean(input.value.trim()));
      row.classList.remove('is-remove');
      const value = row.querySelector<HTMLElement>('[data-review-field-value]');
      if (value) value.textContent = input.value.trim() ? `Replaced with {{${input.value.trim()}}}` : row.dataset.originalValue ?? '';
      const preview = root.querySelector<HTMLElement>('[data-sanitized-inspection-preview]');
      if (preview) preview.textContent = JSON.stringify(applyInspectionPrivacyRules(state.integrationInspectionResult, state.inspectionPrivacyRules), null, 2);
    }
  }, { signal });
  root.addEventListener('dragover', (event) => {
    const pluginDropZone = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-plugin-drop-zone]') : null;
    if (pluginDropZone && hasDraggedFiles(event)) {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      setDragOverTarget(root, pluginDropZone);
      return;
    }
    const dropTarget = workspaceDropTargetFromEvent(event);
    if (!dropTarget || (!hasDraggedFiles(event) && !hasDraggedWorkspaceFile(event))) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = hasDraggedWorkspaceFile(event) ? 'move' : 'copy';
    setDragOverTarget(root, dropTarget.element);
  }, { signal });
  root.addEventListener('dragleave', (event) => {
    const pluginDropZone = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-plugin-drop-zone]') : null;
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (pluginDropZone && (!relatedTarget || !pluginDropZone.contains(relatedTarget))) {
      pluginDropZone.classList.remove('is-drag-over');
      return;
    }
    const dropTarget = workspaceDropTargetFromEvent(event);
    const relatedDropTarget = workspaceDropTargetFromElement(relatedTarget instanceof Element ? relatedTarget : null);
    if (!dropTarget || relatedDropTarget?.element === dropTarget.element) return;
    dropTarget.element.classList.remove('is-drag-over');
  }, { signal });
  root.addEventListener('drop', (event) => {
    const pluginDropZone = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-plugin-drop-zone]') : null;
    if (pluginDropZone && event.dataTransfer?.files.length) {
      event.preventDefault();
      pluginDropZone.classList.remove('is-drag-over');
      const form = pluginDropZone.closest<HTMLFormElement>('form[data-form="app-settings"]');
      handlers.installPluginFiles(
        Array.from(event.dataTransfer.files),
        readAppSettingsForm(new FormData(form!), state.document?.source.path ?? ''),
      );
      return;
    }
    const dropTarget = workspaceDropTargetFromEvent(event);
    const workspacePath = dropTarget?.workspacePath;
    if (!dropTarget || !workspacePath || !event.dataTransfer) return;
    event.preventDefault();
    dropTarget.element.classList.remove('is-drag-over');
    const draggedPath = event.dataTransfer.getData('application/x-hvy-workspace-file');
    if (draggedPath) {
      handlers.moveWorkspaceFileToFolder(draggedPath, workspacePath, dropTarget.targetDirectory);
      return;
    }
    if (event.dataTransfer.files.length) {
      handlers.addDroppedFilesToWorkspace(workspacePath, Array.from(event.dataTransfer.files), dropTarget.targetDirectory);
    }
  }, { signal });
  root.addEventListener('dragstart', (event) => {
    const fileButton = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.tree-file') : null;
    const path = fileButton?.dataset.path;
    if (!fileButton || !path || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-hvy-workspace-file', path);
    event.dataTransfer.setData('text/plain', path);
  }, { signal });
  root.addEventListener('dragend', () => {
    root.querySelectorAll('.is-drag-over').forEach((element) => element.classList.remove('is-drag-over'));
  }, { signal });
  root.addEventListener('beforeinput', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount') || !isFolderlessNameInput(target)) return;
    if (typeof event.data === 'string' && wouldChangeFolderlessNameInput(target, event.data)) {
      event.preventDefault();
    }
  }, { signal });
  root.addEventListener('input', (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (target instanceof HTMLInputElement && !target.closest('#hvyMount') && isFolderlessNameInput(target)) {
      stripInvalidCharactersFromNameInput(target);
    }
    const field = target?.dataset.field;
    if (!target || !field || target.closest('#hvyMount')) return;
    const newWorkspaceForm = target.closest<HTMLFormElement>('form[data-form="new-workspace"]');
    if (newWorkspaceForm) updateNewWorkspaceSubmit(newWorkspaceForm);
    const importForm = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
    if (importForm) updateImportSubmit(importForm);
    if (field === 'workspace-filter-query') {
      handlers.updateWorkspaceFilterQuery(target.value);
      const form = target.closest<HTMLFormElement>('form[data-form="workspace-filter"]');
      if (form) updateWorkspaceFilterSubmit(form);
      return;
    }
    if (field === 'integration-target-label' && target instanceof HTMLInputElement) {
      const index = Number(target.dataset.index);
      handlers.updateIntegrationTargetLabel(index, target.value);
      const builder = target.closest<HTMLElement>('.integration-action-builder-dialog');
      const displayName = target.value.trim() || `Field ${index + 1}`;
      const requiredButton = builder?.querySelector<HTMLButtonElement>(`[data-action="toggle-integration-target-required"][data-index="${index}"]`);
      if (requiredButton) requiredButton.textContent = displayName;
      const removeButton = builder?.querySelector<HTMLButtonElement>(`[data-action="remove-integration-action-selection"][data-kind="target"][data-index="${index}"]`);
      if (removeButton) removeButton.setAttribute('aria-label', `Remove ${displayName}`);
      const complete = builder
        ? [...builder.querySelectorAll<HTMLInputElement>('input[data-field="integration-target-label"]')].every((input) => input.value.trim())
        : false;
      builder?.querySelectorAll<HTMLButtonElement>('[data-action="test-integration-action-pattern"], [data-action="preview-integration-action"]')
        .forEach((button) => { button.disabled = !complete; });
      builder?.querySelectorAll<HTMLButtonElement>('[data-action="save-integration-action-draft"]')
        .forEach((button) => { button.disabled = !complete || !state.integrationActionDraftName.trim() || state.integrationActionAnchors.length === 0 || state.integrationActionPreviewPending; });
      return;
    }
    if (field === 'integration-record-type-name' && target instanceof HTMLInputElement) {
      handlers.updateIntegrationActionDraftName(target.value);
      const builder = target.closest<HTMLElement>('.integration-action-builder-dialog');
      const labelsComplete = builder
        ? [...builder.querySelectorAll<HTMLInputElement>('input[data-field="integration-target-label"]')].every((input) => input.value.trim())
        : false;
      builder?.querySelectorAll<HTMLButtonElement>('[data-action="save-integration-action-draft"]')
        .forEach((button) => { button.disabled = !target.value.trim() || !labelsComplete || state.integrationActionAnchors.length === 0 || state.integrationActionPreviewPending; });
      return;
    }
    if (field === 'integration-record-type-description' && target instanceof HTMLInputElement) {
      handlers.updateIntegrationActionDraftDescription(target.value);
      return;
    }
    if (field === 'integration-action-confidence' && target instanceof HTMLInputElement) {
      handlers.updateIntegrationActionMinimumConfidence(Number(target.value) / 100);
      const output = target.closest('label')?.querySelector<HTMLOutputElement>('output');
      if (output) output.value = `${target.value}%`;
      return;
    }
    if (field === 'scripting-review-filter') {
      const query = target.value.trim().toLocaleLowerCase();
      target.closest('.scripting-review-dialog')
        ?.querySelectorAll<HTMLElement>('.scripting-review-file')
        .forEach((row) => {
          row.hidden = Boolean(query) && !row.innerText.toLocaleLowerCase().includes(query);
        });
      return;
    }
    if (field === 'embeddings-enabled') {
      const form = target.closest<HTMLFormElement>('form[data-form="ai-settings"]');
      if (form) {
        const data = new FormData(form);
        const settings = readAiSettingsForm(data);
        handlers.selectAiProvider(String(data.get('selectedProviderId') ?? settings.activeProviderId), settings);
      }
      return;
    }
    if (field === 'import-source-text') {
      handlers.updateImportSourceText(target.value);
      const form = target.closest<HTMLFormElement>('form[data-form="import-document"], form[data-form="import-current"]');
      if (form) updateImportSubmit(form);
      return;
    }
    if (field === 'search-exclude-tags-input') {
      handleTagEditorInput(target, importExcludeTagHelpers);
      syncImportExcludeTagsState(target, handlers);
      updateImportExcludeTagAutocomplete(target);
      return;
    }
    if (field === 'mcp-port' || field === 'mcp-token') {
      const form = target.closest<HTMLFormElement>('form[data-form="mcp-settings"]');
      if (form) {
        updateMcpConnectionPreview(form);
        updateMcpUrlPreview(form);
      }
      return;
    }
    if (field === 'max-context-chars' && target instanceof HTMLInputElement) {
      syncAiMaxContextCharsOutput(target);
      return;
    }
    if (field === 'theme-color-filter') {
      const dialog = target.closest<HTMLElement>('.color-theme-dialog');
      if (dialog) applyThemeFilter(dialog, target.value);
      return;
    }
    if (field === 'theme-name') {
      handlers.updateColorThemeName(target.value);
      return;
    }
    if (field === 'use-document-colors' && target instanceof HTMLInputElement) {
      handlers.setDocumentColorsEnabled(target.checked);
      return;
    }
    if (field !== 'theme-color-picker' && field !== 'theme-color-value' && field !== 'theme-color-alpha') return;
    const name = target.dataset.colorName ?? '';
    if (!name) return;
    const row = target.closest<HTMLElement>('.theme-color-row');
    const valueInput = row?.querySelector<HTMLInputElement>('[data-field="theme-color-value"]');
    const pickerInput = row?.querySelector<HTMLInputElement>('[data-field="theme-color-picker"]');
    let nextValue = target.value;
    if (field === 'theme-color-picker') {
      nextValue = mergePickerHexIntoCssColor(target.value, valueInput?.value ?? '');
      if (valueInput) valueInput.value = nextValue;
    }
    if (field === 'theme-color-value' && pickerInput) {
      pickerInput.value = colorValueToPickerHex(target.value);
    }
    if (field === 'theme-color-alpha') {
      nextValue = mergeAlphaIntoCssColor(valueInput?.value ?? '', Number.parseFloat(target.value));
      if (valueInput) valueInput.value = nextValue;
      if (pickerInput) pickerInput.value = colorValueToPickerHex(nextValue);
    }
    syncThemeAlphaControl(row, nextValue);
    const overridden = nextValue.trim().length > 0;
    row?.classList.toggle('theme-color-row--override', overridden);
    syncThemeOverrideAction(row, name, overridden);
    handlers.updateColorTheme(name, nextValue);
  }, { signal });
  root.addEventListener('keydown', (event) => {
    const chatTarget = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (
      chatTarget?.dataset.field === 'workspace-chat-draft' &&
      event.key === 'Enter' &&
      !event.shiftKey
    ) {
      event.preventDefault();
      chatTarget.closest('form')?.requestSubmit();
      return;
    }
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount')) return;
    if (handleTagEditorKeydown(event, target, importExcludeTagHelpers)) {
      syncImportExcludeTagsState(target, handlers);
      updateImportExcludeTagAutocomplete(target);
    }
  }, { signal });
  root.addEventListener('focusin', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount') || target.dataset.field !== 'search-exclude-tags-input') return;
    updateImportExcludeTagAutocomplete(target);
  }, { signal });
  root.addEventListener('focusout', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.closest('#hvyMount') || target.dataset.field !== 'search-exclude-tags-input') return;
    commitTagEditorDraft(target, importExcludeTagHelpers);
    syncImportExcludeTagsState(target, handlers);
    updateImportExcludeTagAutocomplete(target);
  }, { signal });
  root.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || target.closest('#hvyMount')) return;
    if (target instanceof HTMLSelectElement && target.dataset.action === 'select-integration-profile') {
      handlers.selectIntegrationProfile(target.value);
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.action === 'select-document-encryption-key') {
      handlers.selectDocumentEncryptionKey(target.value);
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.action === 'integration-ready-url-mode') {
      const form = target.closest<HTMLFormElement>('form[data-form="integration-ready-checks"]');
      const input = form?.querySelector<HTMLInputElement>('input[name="urlValue"]');
      const help = form?.querySelector<HTMLElement>('[data-ready-url-help]');
      const pageUrl = target.dataset.pageUrl ? new URL(target.dataset.pageUrl) : null;
      if (input && pageUrl) {
        input.value = target.value === 'strict-url'
          ? pageUrl.href
          : target.value === 'strict-domain'
            ? pageUrl.hostname
            : `^${pageUrl.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      }
      if (help) help.textContent = target.value === 'strict-url'
        ? 'The complete URL, including its path, query, and fragment, must match.'
        : target.value === 'strict-domain'
          ? 'The current hostname must match exactly.'
          : 'The regular expression is evaluated against the current hostname.';
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.action === 'set-integration-quick-view-profile' && target.dataset.integrationId && target.dataset.pageId && target.dataset.profileId) {
      handlers.setIntegrationQuickViewProfile(target.dataset.integrationId, target.dataset.pageId, target.dataset.profileId, target.checked);
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'integration-target-cardinality') {
      handlers.updateIntegrationTargetCardinality(Number(target.dataset.index), target.value === 'list' ? 'list' : 'single');
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'integration-target-optional') {
      handlers.updateIntegrationTargetOptional(Number(target.dataset.index), target.value === 'optional');
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.field === 'integration-target-cardinality-checkbox') {
      handlers.updateIntegrationTargetCardinality(Number(target.dataset.index), target.checked ? 'list' : 'single');
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.field === 'integration-target-required-checkbox') {
      handlers.updateIntegrationTargetOptional(Number(target.dataset.index), !target.checked);
      return;
    }
    const debugLogSettings = target.closest<HTMLElement>('[data-settings="debug-log"]');
    if (debugLogSettings && (target instanceof HTMLInputElement) && (target.name === 'debugSemanticSearch' || target.name === 'debugLogMaxMegabytes')) {
      handlers.saveDebugLogSettings(readDebugLogSettingsControls(debugLogSettings, state.appSettings));
      return;
    }
    if (target instanceof HTMLInputElement && target.name === 'newSectionsOnly') {
      handlers.setImportNewSectionsOnly(target.checked);
      return;
    }
    if (
      target instanceof HTMLInputElement
      && target.type === 'checkbox'
      && ['hvyDocuments', 'thvyTemplates', 'phvyTemplates', 'archivedFiles'].includes(target.name)
    ) {
      const form = target.closest<HTMLFormElement>('form[data-form="workspace-filter"]');
      if (form) {
        handlers.saveWorkspaceTemplateVisibility(String(form.dataset.workspacePath ?? ''), readWorkspaceTemplateVisibilityForm(new FormData(form)));
      }
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'import-workspace-source') {
      handlers.selectImportWorkspaceSource(target.value);
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'ai-action-provider') {
      syncAiActionModelForProvider(target);
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'ai-embedding-provider') {
      syncAiEmbeddingModelForProvider(target);
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'ai-embedding-model-preset') {
      syncAiEmbeddingCustomModelInput(target);
    }
  }, { signal });
}

export const folderlessNameInputNames = new Set(['documentName', 'fileName', 'importOutputName', 'templateName']);

export const invalidNameInputCharactersPattern = /[<>:"/\\|?*\x00-\x1f]/g;

export const leadingNameInputPeriodsPattern = /^\.+/;

export function isFolderlessNameInput(input: HTMLInputElement): boolean {
  return input.type === 'text' && folderlessNameInputNames.has(input.name);
}

export function wouldChangeFolderlessNameInput(input: HTMLInputElement, insertedText: string): boolean {
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  const nextValue = `${input.value.slice(0, selectionStart)}${insertedText}${input.value.slice(selectionEnd)}`;
  return sanitizeFolderlessNameInputValue(nextValue) !== nextValue;
}

export function stripInvalidCharactersFromNameInput(input: HTMLInputElement): void {
  const sanitized = sanitizeFolderlessNameInputValue(input.value);
  if (sanitized === input.value) return;
  const selectionStart = input.selectionStart ?? input.value.length;
  const sanitizedBeforeSelection = sanitizeFolderlessNameInputValue(input.value.slice(0, selectionStart));
  input.value = sanitized;
  const nextSelection = Math.min(sanitizedBeforeSelection.length, sanitized.length);
  input.setSelectionRange(nextSelection, nextSelection);
}

export function sanitizeFolderlessNameInputValue(value: string): string {
  return value
    .replace(invalidNameInputCharactersPattern, '')
    .replace(leadingNameInputPeriodsPattern, '');
}
