import { installAiChatClient } from './aiClient';
import { includedDocuments, loadAiSettings, loadAppSettings, loadArchivedWorkspaces, loadIncludedDocument, loadLaunchDocumentPaths, loadMcpClientInstallStatus, loadMcpServerStatus, loadMcpSettings, loadMcpStdioLaunchConfig, loadRecentState, onAppCloseRequest, onIntegrationInspectionResult, onMenuEvent, onOpenDocumentPath, readDocumentFile, readSystemClipboardText, startMcpServer, type DocumentFile } from './backend';
import { controlIntegrationBrowser } from './integrationBrowser';
import { applyColorTheme, loadColorThemeSettings } from './colorTheme';
import { configureDebugLog, measureDebug, measureDebugAsync } from './debugLog';
import { copyMountedDocumentAsRichText, deserializeHvy, redoMountedDocument, undoMountedDocument } from './hvy';
import { state, workspaceRelativeFilePath } from './state';
import { handlers, clearArchivedHomepageDocument, cssEscape, defaultDocumentMode, documentSessions, fileNameFromPath, hasOpenedDocumentTabs, handleAppCloseRequest, loadWorkspaceEntry, loadZoomSettings, applyZoomSettings, markDocumentTabOpened, mountRoot, openDocument, openLaunchDocumentPath, openRecoveryDialog, openRecoveryDialogOnBoot, preserveCurrentDocumentSession, readDocumentColorPreference, readHotReloadSessionSnapshot, refreshSavedTemplates, renderAllAroundDocument, rerender, restoreMountScrollRatio, runBusy, selectDocumentTab, setMountRoot, setupErrorSurface, showStartupError, syncDocumentTabs, syncFileMenuState, syncMcpWorkspaces, workspaceDisplayNameFromPath, workspaceFileAiAccess, writeHotReloadSessionSnapshot, type DocumentSession, type HotReloadDocumentSnapshot } from './main';
import { setupRecoveryLifecycle, startBackupTimer } from './mainDocumentSave';
import { render } from './ui';
import { beginDocumentNavigation, cancelDocumentNavigation, type DocumentNavigationDirection } from './documentNavigationHistory';
import { availableRecoveryBackups } from './recoveryDocuments';
import { refreshInstalledPlugins } from './pluginManager';
import { handleWebCapabilityIntegrationResult } from './webCapabilityRuntime';

let findShortcutBound = false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    preserveCurrentDocumentSession();
    writeHotReloadSessionSnapshot();
  });
}

export async function boot(): Promise<void> {
  setupErrorSurface();
  try {
    loadZoomSettings();
    setMountRoot(render(state, handlers));
    applyZoomSettings();
    bindFindShortcut();
    bindDocumentNavigationInputs();
    bindNativeZoomGestureSuppression();
    await refreshRecents();
    await refreshArchivedWorkspaces();
    state.appSettings = await loadAppSettings();
    await refreshInstalledPlugins();
    configureDebugLog({ maxBytes: state.appSettings.debugLogMaxBytes });
    state.aiSettings = await loadAiSettings();
    state.mcpSettings = await loadMcpSettings();
    state.mcpServerStatus = await loadMcpServerStatus();
    state.mcpStdioLaunchConfig = await loadMcpStdioLaunchConfig();
    state.mcpClientInstallStatus = await loadMcpClientInstallStatus();
    if (state.mcpSettings.startAutomatically && !state.mcpServerStatus.running) {
      state.mcpServerStatus = await startMcpServer();
    }
    state.colorTheme = loadColorThemeSettings();
    applyAppColorTheme();
    installAiChatClient(state.aiSettings, state.appSettings);
    await onAppCloseRequest(() => {
      void handleAppCloseRequest();
    });
    await onIntegrationInspectionResult(async (result) => {
      if (handleWebCapabilityIntegrationResult(result)) return;
      if (result && typeof result === 'object'
        && (result as { context?: { mode?: unknown } }).context?.mode === 'ready-check') {
        handlers.completeIntegrationReadyCheck(result);
        await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-toolbar-action') {
        const action = (result as { action?: unknown }).action;
        const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.selectedIntegrationId);
        const page = integration?.pages[0];
        if (!integration || !page) throw new Error('The selected integration page is unavailable.');
        if (action === 'add-page-command') handlers.addCommandForIntegrationPage(integration.id, page.id);
        if (action === 'define-record-type') handlers.addActionForIntegrationPage(integration.id, page.id);
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-source-discovery') {
        const discovery = result as { context?: { pageId?: string }; sources?: import('./integrationBrowser').IntegrationStructuredSource[] };
        state.integrationStructuredSourcePending = false;
        state.integrationStructuredSourceError = null;
        const selectedPageId = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.selectedIntegrationId)?.pages[0]?.id ?? null;
        state.integrationStructuredSourcePageId = discovery.context?.pageId ?? selectedPageId;
        state.integrationStructuredSources = discovery.sources ?? [];
        state.status = state.integrationStructuredSources.length
          ? `Found ${state.integrationStructuredSources.length} structured data source${state.integrationStructuredSources.length === 1 ? '' : 's'}`
          : 'No structured data sources found';
        rerender({ preserveMountedDocument: true });
        if (!(discovery.context as { automatic?: boolean } | undefined)?.automatic) await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-structured-result') {
        const structured = result as { context?: { sourceName?: string }; value?: unknown };
        state.integrationStructuredSourcePending = false;
        state.integrationStructuredSourceError = null;
        state.integrationStructuredResultName = structured.context?.sourceName ?? 'Structured data';
        state.integrationStructuredResult = structured.value;
        state.integrationStructuredResultOpen = true;
        state.status = `Fetched ${state.integrationStructuredResultName}`;
        rerender({ preserveMountedDocument: true });
        await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-structured-error') {
        state.integrationStructuredSourcePending = false;
        state.integrationStructuredSourceError = String((result as { message?: unknown }).message ?? 'The structured source could not be fetched.');
        state.status = 'Structured data fetch failed';
        rerender({ preserveMountedDocument: true });
        await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-command-recording-cancelled') {
        state.integrationCommandBuilderOpen = false;
        state.integrationCommandSelectionPending = false;
        state.integrationCommandDraftSteps = [];
        state.status = 'Command recording cancelled';
        rerender({ preserveMountedDocument: true });
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-command-recording') {
        const recording = result as { steps?: unknown };
        state.integrationCommandSelectionPending = false;
        state.integrationCommandDraftSteps = Array.isArray(recording.steps) ? recording.steps : [];
        state.integrationCommandBuilderOpen = true;
        state.status = `Recorded ${state.integrationCommandDraftSteps.length} verified ${state.integrationCommandDraftSteps.length === 1 ? 'step' : 'steps'}`;
        rerender({ preserveMountedDocument: true });
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-command-result') {
        const commandResult = result as { commandId?: unknown; status?: unknown; reason?: unknown; message?: unknown; stepIndex?: unknown; stepsExecuted?: unknown };
        const failedStep = typeof commandResult.stepIndex === 'number' ? ` at step ${commandResult.stepIndex + 1}` : '';
        state.status = commandResult.status === 'executed'
          ? `Ran command${typeof commandResult.stepsExecuted === 'number' ? ` · ${commandResult.stepsExecuted} ${commandResult.stepsExecuted === 1 ? 'step' : 'steps'}` : ''}`
          : commandResult.status === 'ambiguous'
            ? `Command stopped${failedStep}: more than one control matched`
            : commandResult.status === 'not-ready'
              ? String(commandResult.message || 'The expected page is not ready.')
            : `Command stopped${failedStep}: ${String(commandResult.reason || 'target not found').replaceAll('_', ' ')}`;
        rerender({ preserveMountedDocument: true });
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-extraction') {
        state.integrationActionFetchPendingId = null;
        state.integrationActionFetchError = null;
        const extraction = result as { status?: string; message?: string; context?: { mode?: string; actionId?: string; actionName?: string }; records?: unknown[]; diagnostics?: unknown; minimumConfidence?: unknown };
        if (extraction.status === 'not-ready') {
          state.integrationActionPreviewPending = false;
          state.integrationActionEditPageLoading = false;
          state.integrationActionFetchError = extraction.message ?? 'The expected page is not ready.';
          state.status = 'Page is not ready';
          rerender({ preserveMountedDocument: true });
          await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
          return;
        }
        if (typeof extraction.minimumConfidence === 'number') state.integrationActionMinimumConfidence = Math.max(0.5, Math.min(0.95, extraction.minimumConfidence));
        const isBackgroundExampleValidation = extraction.context?.mode === 'examples';
        if (isBackgroundExampleValidation) {
          state.integrationActionLiveExampleRecords = extraction.records ?? [];
          state.integrationActionEditPageLoading = false;
          state.status = `Validated ${(extraction.records ?? []).filter(Boolean).length} live examples`;
        } else if (extraction.context?.mode === 'builder') {
          state.integrationActionPreviewPending = false;
          state.integrationActionPreviewRecords = extraction.records ?? [];
          state.integrationActionPreviewDiagnostics = extraction.diagnostics ?? null;
          state.integrationActionBuilderStep = 'preview';
          state.integrationActionBuilderOpen = true;
        } else {
          state.integrationActionResultName = extraction.context?.actionName ?? 'Action results';
          state.integrationActionResultRecords = extraction.records ?? [];
          state.integrationActionResultActionId = extraction.context?.actionId ?? null;
          state.integrationActionResultOpen = true;
        }
        state.status = `Extracted ${(extraction.records ?? []).length} matching items`;
        rerender({ preserveMountedDocument: true });
        if (!isBackgroundExampleValidation) await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-browser-closed') {
        if (state.integrationReadyCheckSelectionPending) {
          state.integrationReadyCheckSelectionPending = false;
          state.integrationReadyChecksDialogOpen = true;
        }
        state.integrationActionSelectionPending = false;
        state.integrationActionPreviewPending = false;
        state.integrationActionBuilderOpen = true;
        if (state.integrationCommandBuilderOpen) {
          state.integrationCommandBuilderOpen = false;
          state.integrationCommandSelectionPending = false;
          state.integrationCommandDraftSteps = [];
        }
        state.status = 'Integration browser closed';
        rerender({ preserveMountedDocument: true });
        return;
      }
      if (result && typeof result === 'object' && (result as { kind?: unknown }).kind === 'integration-target-collection') {
        const items = Array.isArray((result as { items?: unknown }).items) ? (result as { items: unknown[] }).items : [];
        const parentIndex = state.integrationActionTargetSelectionParentIndex;
        items.forEach((item) => {
          state.integrationActionExamples.push(item);
          state.integrationActionTargetIds.push(`field-${crypto.randomUUID()}`);
          state.integrationActionExampleRules.push([]);
          state.integrationActionTargetLabels.push('');
          state.integrationActionTargetCardinalities.push('single');
          state.integrationActionTargetOptional.push(true);
          state.integrationActionTargetParentIndexes.push(parentIndex);
          const variants = Array(state.integrationActionAnchors.length).fill(null);
          variants[parentIndex] = item;
          state.integrationActionTargetVariants.push(variants);
          state.integrationActionTargetNegativeVariants.push(Array(state.integrationActionAnchors.length).fill(null));
          state.integrationActionTargetAbsentExamples.push(Array(state.integrationActionAnchors.length).fill(false));
        });
        state.integrationActionSelectionPending = false;
        state.integrationActionBuilderOpen = true;
        state.integrationActionTargetSelectionFieldIndex = null;
        state.status = items.length === 0
          ? 'Canceled field selection'
          : `Selected ${items.length} ${items.length === 1 ? 'field' : 'fields'}`;
        rerender({ preserveMountedDocument: true });
        await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
        return;
      }
      state.integrationInspectionResult = result;
      state.inspectionPrivacyRules = [];
      state.integrationActionBuilderOpen = true;
      state.integrationActionSelectionPending = false;
      let collectInitialFields = false;
      let collectExistingFields = false;
      if (state.integrationActionSelectionKind === 'parent' || state.integrationActionSelectionKind === 'example') {
        const parentIndex = state.integrationActionAnchors.length;
        state.integrationActionAnchors.push(result);
        state.integrationActionAnchorRules.push([]);
        state.integrationActionSelectedParentIndex = parentIndex;
        const suggestions = result && typeof result === 'object' && Array.isArray((result as { suggestedTargets?: unknown }).suggestedTargets)
          ? (result as { suggestedTargets: Array<{ snapshot?: unknown }> }).suggestedTargets
          : [];
        state.integrationActionTargetVariants.forEach((variants, fieldIndex) => {
          variants[parentIndex] = suggestions[fieldIndex]?.snapshot ?? null;
          state.integrationActionTargetNegativeVariants[fieldIndex][parentIndex] = null;
          state.integrationActionTargetAbsentExamples[fieldIndex][parentIndex] = false;
        });
        if (state.integrationActionSelectionKind === 'parent' && state.integrationActionExamples.length === 0) {
          state.integrationActionSelectionKind = 'target';
          state.integrationActionTargetSelectionParentIndex = parentIndex;
          state.integrationActionTargetSelectionFieldIndex = null;
          state.integrationActionSelectionPending = true;
          collectInitialFields = true;
        } else if (state.integrationActionSelectionKind === 'example' && state.integrationActionExamples.length > 0) {
          state.integrationActionSelectionKind = 'target';
          state.integrationActionTargetSelectionParentIndex = parentIndex;
          state.integrationActionTargetSelectionFieldIndex = 0;
          state.integrationActionSelectionPending = true;
          collectExistingFields = true;
        }
      } else {
        const fieldIndex = state.integrationActionTargetSelectionFieldIndex;
        const parentIndex = state.integrationActionTargetSelectionParentIndex;
        if (fieldIndex === null) {
          state.integrationActionExamples.push(result);
          state.integrationActionTargetIds.push(`field-${crypto.randomUUID()}`);
          state.integrationActionExampleRules.push([]);
          state.integrationActionTargetLabels.push('');
          state.integrationActionTargetCardinalities.push('single');
          state.integrationActionTargetOptional.push(true);
          state.integrationActionTargetParentIndexes.push(parentIndex);
          const variants = Array(state.integrationActionAnchors.length).fill(null);
          variants[parentIndex] = result;
          state.integrationActionTargetVariants.push(variants);
          state.integrationActionTargetNegativeVariants.push(Array(state.integrationActionAnchors.length).fill(null));
          state.integrationActionTargetAbsentExamples.push(Array(state.integrationActionAnchors.length).fill(false));
        } else {
          state.integrationActionTargetVariants[fieldIndex][parentIndex] = result;
          state.integrationActionTargetNegativeVariants[fieldIndex][parentIndex] = null;
          state.integrationActionTargetAbsentExamples[fieldIndex][parentIndex] = false;
          state.integrationActionExamples[fieldIndex] = state.integrationActionTargetVariants[fieldIndex].find(Boolean) ?? result;
          const nextFieldIndex = fieldIndex + 1;
          if (nextFieldIndex < state.integrationActionExamples.length) {
            state.integrationActionTargetSelectionFieldIndex = nextFieldIndex;
            state.integrationActionSelectionPending = true;
            state.status = `Select ${state.integrationActionTargetLabels[nextFieldIndex] || `field ${nextFieldIndex + 1}`} in this example`;
            rerender({ preserveMountedDocument: true });
            const parentSnapshot = state.integrationActionAnchors[parentIndex];
            const parentCssPath = (parentSnapshot as { selected?: { cssPath?: string } } | undefined)?.selected?.cssPath;
            await controlIntegrationBrowser('inspect-target', state.selectedIntegrationProfileId, { parentCssPath, parentSnapshot });
            return;
          }
        }
        state.integrationActionTargetSelectionFieldIndex = null;
      }
      if (result && typeof result === 'object' && typeof (result as { profileId?: unknown }).profileId === 'string') {
        const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === (result as { profileId: string }).profileId);
        if (profile) {
          state.selectedIntegrationProfileId = profile.id;
        }
      }
      rerender({ preserveMountedDocument: true });
      if (collectInitialFields) {
        const parentCssPath = (result as { selected?: { cssPath?: string } }).selected?.cssPath;
        await controlIntegrationBrowser('inspect-target', state.selectedIntegrationProfileId, { parentCssPath, parentSnapshot: result, multiSelect: true });
        return;
      }
      if (collectExistingFields) {
        const parentCssPath = (result as { selected?: { cssPath?: string } }).selected?.cssPath;
        state.status = `Select ${state.integrationActionTargetLabels[0] || 'field 1'} in this example`;
        rerender({ preserveMountedDocument: true });
        await controlIntegrationBrowser('inspect-target', state.selectedIntegrationProfileId, { parentCssPath, parentSnapshot: result });
        return;
      }
      await controlIntegrationBrowser('focus-main', state.selectedIntegrationProfileId);
    });
    await onMenuEvent((event) => {
      if (event === 'new-workspace') handlers.newWorkspace();
      if (event === 'manage-workspaces') handlers.openWorkspaceManager();
      if (event === 'open-workspace') handlers.openWorkspace();
      if (event === 'open-file') handlers.openFile();
      if (event === 'find') openMountedSearch();
      if (event === 'bold') performRichTextAction('bold');
      if (event === 'italic') performRichTextAction('italic');
      if (event === 'underline') performRichTextAction('underline');
      if (event === 'strikethrough') performRichTextAction('strikethrough');
      if (event === 'paste-plain-text') void pastePlainTextFromSystemClipboard();
      if (event === 'copy-document-rich-text') void copyCurrentDocumentAsRichText();
      if (event === 'undo') void performUndo();
      if (event === 'redo') void performRedo();
      if (event === 'open-guide') void openGuide();
      if (event === 'open-hvy-guide') void openHvyGuide();
      if (event === 'about') handlers.openAbout();
      if (event === 'debug-log') handlers.openDebugLog();
      if (event === 'app-settings') handlers.openAppSettings();
      if (event === 'review-scripting') handlers.openScriptingReview();
      if (event === 'manage-plugins') handlers.openPluginManager();
      if (event === 'ai-settings') handlers.openAiSettings();
      if (event === 'mcp-settings') handlers.openMcpSettings();
      if (event === 'colors') handlers.openColorTheme();
      if (event === 'zoom-app-in') handlers.zoomAppIn();
      if (event === 'zoom-app-out') handlers.zoomAppOut();
      if (event === 'zoom-app-reset') handlers.resetAppZoom();
      if (event === 'zoom-document-in') handlers.zoomDocumentIn();
      if (event === 'zoom-document-out') handlers.zoomDocumentOut();
      if (event === 'zoom-document-reset') handlers.resetDocumentZoom();
      if (event === 'recover-backup') void openRecoveryDialog();
      if (event === 'version-history') handlers.openVersionHistory();
      if (event === 'navigate-back') void navigateDocumentHistory('back');
      if (event === 'navigate-forward') void navigateDocumentHistory('forward');
      if (event === 'app-close-requested') void handleAppCloseRequest();
      if (event === 'close-document') handlers.closeDocument();
      if (event === 'save') handlers.save();
      if (event === 'save-as') handlers.saveAs();
      if (event === 'save-to-workspace') handlers.saveCurrentToWorkspace();
      if (event === 'import-current') handlers.openImportIntoCurrent();
      if (event === 'export-pdf') handlers.exportPdf();
      if (event.startsWith('recent-workspace:')) handlers.openRecentWorkspace(event.slice('recent-workspace:'.length));
      if (event.startsWith('recent-file:')) handlers.openRecentFile(event.slice('recent-file:'.length));
    });
    await onOpenDocumentPath((path) => {
      void openLaunchDocumentPath(path);
    });
    const launchDocumentPaths = await loadLaunchDocumentPaths();
    for (const path of launchDocumentPaths) {
      await openLaunchDocumentPath(path);
    }
    if (state.document) {
      void loadStartupWorkspacesInBackground();
    } else {
      await loadRecentWorkspaces();
      await refreshSavedTemplates(state.selectedWorkspacePath);
      setMountRoot(render(state, handlers));
      applyZoomSettings();
    }
    syncFileMenuState({ force: true });
    await openRecoveryDialogOnBoot();
    startBackupTimer();
    setupRecoveryLifecycle();
    if (!state.document) {
      await restoreStartupDocument();
    }
    await openHomepage();
  } catch (error) {
    showStartupError(error);
  }
}

export async function navigateDocumentHistory(direction: DocumentNavigationDirection): Promise<void> {
  const path = beginDocumentNavigation(direction);
  if (!path) return;
  try {
    await selectDocumentTab(path);
  } catch (error) {
    cancelDocumentNavigation(direction);
    showStartupError(error);
  }
}

let documentNavigationInputsBound = false;

export function bindDocumentNavigationInputs(): void {
  if (documentNavigationInputsBound) return;
  documentNavigationInputsBound = true;
  window.addEventListener('auxclick', (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    void navigateDocumentHistory(event.button === 3 ? 'back' : 'forward');
  });
}

let nativeZoomGestureSuppressionBound = false;

export function bindNativeZoomGestureSuppression(): void {
  if (nativeZoomGestureSuppressionBound) return;
  nativeZoomGestureSuppressionBound = true;
  const preventNativeZoom = (event: Event) => event.preventDefault();
  window.addEventListener('gesturestart', preventNativeZoom, { passive: false });
  window.addEventListener('gesturechange', preventNativeZoom, { passive: false });
  window.addEventListener('gestureend', preventNativeZoom, { passive: false });
  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  }, { passive: false });
}

export async function copyCurrentDocumentAsRichText(): Promise<void> {
  const mounted = state.document?.mounted;
  if (!mounted) return;
  try {
    await copyMountedDocumentAsRichText(mounted);
    state.status = 'Copied document as rich text';
  } catch (error) {
    state.status = `Could not copy document as rich text: ${error instanceof Error ? error.message : String(error)}`;
  }
  rerender({ preserveMountedDocument: true });
}

export function bindFindShortcut(): void {
  if (findShortcutBound) return;
  findShortcutBound = true;
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return;
    if (!openMountedSearch()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
}

export function openMountedSearch(): boolean {
  const root = currentMountRoot();
  if (!state.document || !root) return false;
  const rawSearchBar = root.querySelector<HTMLElement>('.raw-hvy-search-bar');
  if (rawSearchBar) {
    rawSearchBar.closest<HTMLElement>('.raw-hvy-shell')?.dispatchEvent(new CustomEvent('hvy:open-raw-search'));
    const rawInput = root.querySelector<HTMLInputElement>('[data-field="raw-hvy-search-query"]');
    if (rawInput) {
      rawInput.focus();
      rawInput.setSelectionRange(0, rawInput.value.length);
      return true;
    }
  }
  const input = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field="search-query"], [data-field="raw-hvy-search-query"]'))
    .find((candidate) => !candidate.closest('[hidden]'));
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  }
  const launcher = root.querySelector<HTMLButtonElement>('[data-action="open-search"]');
  if (!launcher) return false;
  launcher.click();
  return true;
}

export function performRichTextAction(action: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
  const root = currentMountRoot();
  const rawShell = root?.querySelector<HTMLElement>('.raw-hvy-shell');
  if (rawShell) {
    rawShell.dispatchEvent(new CustomEvent(`hvy:toggle-raw-${action}`));
    return;
  }
  const editable = getActiveRichEditable();
  if (!editable || !root) return;
  const sectionKey = editable.dataset.sectionKey ?? '';
  const blockId = editable.dataset.blockId ?? '';
  const field = editable.dataset.field ?? '';
  const selector = [
    `[data-rich-action="${action}"]`,
    sectionKey ? `[data-section-key="${cssEscape(sectionKey)}"]` : '',
    blockId ? `[data-block-id="${cssEscape(blockId)}"]` : '',
    field ? `[data-field="${cssEscape(field)}"]` : '',
  ].join('');
  const button =
    root.querySelector<HTMLButtonElement>(selector) ??
    editable.closest<HTMLElement>('.editor-block, .table-inline-edit-shell')?.querySelector<HTMLButtonElement>(`[data-rich-action="${action}"]`);
  button?.click();
}

async function pastePlainTextFromSystemClipboard(): Promise<void> {
  const text = await readSystemClipboardText();
  if (!text) return;
  const target = document.activeElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    pastePlainTextIntoTextControl(target, text);
    return;
  }
  const editable = getActiveRichEditable();
  if (!editable) return;
  const transfer = new DataTransfer();
  transfer.setData('text/plain', text);
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertFromPasteAsQuotation',
  });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  editable.dispatchEvent(event);
}

function pastePlainTextIntoTextControl(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
}

export function currentMountRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#hvyMount') ?? mountRoot;
}

export function getActiveRichEditable(): HTMLElement | null {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement) || !target.closest('#hvyMount')) return null;
  if (target.isContentEditable && target.dataset.field) return target;
  return target.closest<HTMLElement>('[contenteditable="true"][data-field]');
}

export async function performUndo(): Promise<void> {
  if (measureDebug('perf', 'undo:routeNativeEditCommand', undefined, () => routeNativeEditCommand('undo'))) return;
  const mounted = state.document?.mounted;
  if (!mounted) return;
  await measureDebugAsync('perf', 'undo:mountedDocument', { path: state.document?.path }, () => undoMountedDocument(mounted));
}

export async function performRedo(): Promise<void> {
  if (measureDebug('perf', 'redo:routeNativeEditCommand', undefined, () => routeNativeEditCommand('redo'))) return;
  const mounted = state.document?.mounted;
  if (!mounted) return;
  await measureDebugAsync('perf', 'redo:mountedDocument', { path: state.document?.path }, () => redoMountedDocument(mounted));
}

export function routeNativeEditCommand(command: 'undo' | 'redo'): boolean {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return false;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return false;
  if (target.closest('#hvyMount') && target.isContentEditable && !document.queryCommandEnabled(command)) return false;
  document.execCommand(command);
  return true;
}

export function applyAppColorTheme(root: HTMLElement | null = mountRoot): void {
  applyColorTheme(state.colorTheme);
  const mounted = state.document?.mounted;
  if (!root || !mounted) return;
  mounted.mount.setThemeOverrides(
    readDocumentColorPreference(state.document?.path ?? '') ? null : state.colorTheme.colors,
  );
}

export async function refreshRecents(): Promise<void> {
  state.recent = await loadRecentState();
}

export async function refreshArchivedWorkspaces(): Promise<void> {
  state.archivedWorkspaces = await loadArchivedWorkspaces();
}

export async function refreshMcpClientInstallStatus(): Promise<void> {
  try {
    state.mcpClientInstallStatus = await loadMcpClientInstallStatus();
    rerender({ preserveMountedDocument: true });
  } catch {
    // The modal still shows the manual config if client detection is unavailable.
  }
}

export async function loadRecentWorkspaces(): Promise<void> {
  state.workspaceEntries = state.recent.workspaces.map((path) => ({
    path,
    displayName: workspaceDisplayNameFromPath(path),
    status: 'loading',
    error: null,
  }));
  rerender({ preserveMountedDocument: true });
  await Promise.all(state.recent.workspaces.map((path) => loadWorkspaceEntry(path)));
  await clearArchivedHomepageDocument();
  state.selectedWorkspacePath = state.workspaces[0]?.path ?? null;
  syncMcpWorkspaces();
}

export async function loadStartupWorkspacesInBackground(): Promise<void> {
  try {
    await loadRecentWorkspaces();
    await refreshSavedTemplates(state.selectedWorkspacePath);
    if (state.recoveryDialogOpen) {
      state.recoveryBackups = availableRecoveryBackups(state.recoveryBackups, state.workspaces);
    }
    renderAllAroundDocument();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    renderAllAroundDocument();
  }
}

export async function openDefaultGuide(options: { force?: boolean } = {}): Promise<void> {
  if (!options.force && (state.document || state.documentTabs.length > 0 || state.selectedFilePath)) return;
  try {
    await openDocument(await loadIncludedDocument('hvy-galaxy-guide'), { defaultDocument: true, defaultDocumentLabel: 'HVY Galaxy guide', includedDocumentId: 'hvy-galaxy-guide' });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load HVY Galaxy guide';
    setMountRoot(render(state, handlers));
  }
}

export async function openHomepage(): Promise<void> {
  if (state.document || state.documentTabs.length > 0 || state.selectedFilePath) return;
  const homepage = state.appSettings.homepage;
  if (homepage.kind === 'none') return;
  try {
    if (homepage.kind === 'included') {
      const included = includedDocuments.find((document) => document.id === homepage.id);
      await openDocument(await loadIncludedDocument(homepage.id), {
        defaultDocument: true,
        defaultDocumentLabel: included?.name ?? 'included document',
        includedDocumentId: homepage.id,
      });
    } else {
      await openDocument(await readDocumentFile(homepage.path));
    }
    state.homepageError = null;
  } catch {
    const target = homepage.kind === 'file'
      ? workspaceRelativeFilePath(state.workspaces, state.workspaceEntries.map((entry) => entry.path), homepage.path)
      : includedDocuments.find((document) => document.id === homepage.id)?.name ?? homepage.id;
    const detail = homepage.kind === 'file'
      ? 'This document is not currently available in its workspace.'
      : 'This included document is not currently available.';
    state.homepageError = `${target}\n\n${detail}`;
    state.status = 'Could not open homepage';
    setMountRoot(render(state, handlers));
  }
}

export async function restoreStartupDocument(): Promise<void> {
  if (documentSessions.size > 0 || hasOpenedDocumentTabs() || state.documentTabs.length > 0) {
    syncDocumentTabs();
    const restoredTab = state.documentTabs.find((tab) => tab.dirty && !tab.readOnly) ?? state.documentTabs.find((tab) => !tab.readOnly);
    if (restoredTab) {
      await selectDocumentTab(restoredTab.path);
      return;
    }
  }
  const restoredFromSnapshot = await restoreHotReloadSession();
  if (restoredFromSnapshot || state.document) return;
  for (const path of state.recent.files) {
    try {
      await openDocument(await readDocumentFile(path));
      state.status = `Restored ${fileNameFromPath(path)}`;
      await refreshRecents();
      return;
    } catch {
      // Recents are pruned by the backend when opened from the menu; boot restore just skips stale entries.
    }
  }
}

export async function restoreHotReloadSession(): Promise<boolean> {
  const snapshot = readHotReloadSessionSnapshot();
  if (!snapshot) return false;
  if (snapshot.tabPaths.length === 0) return true;
  let fallbackActivePath: string | null = null;
  for (const path of [...snapshot.tabPaths].reverse()) {
    if (path === snapshot.activePath) continue;
    const file = await readSnapshotDocumentFile(path);
    if (!file) continue;
    const stored = snapshot.documents.find((candidate) => candidate.path === path);
    documentSessions.set(path, await createSessionFromHotReloadSnapshot(file, stored));
    markDocumentTabOpened(path);
    fallbackActivePath = path;
  }
  const activePath = snapshot.activePath ?? fallbackActivePath;
  const activeFile = activePath ? await readSnapshotDocumentFile(activePath) : null;
  if (activeFile && activePath) {
    const stored = snapshot.documents.find((candidate) => candidate.path === activePath);
    documentSessions.set(activePath, await createSessionFromHotReloadSnapshot(activeFile, stored));
    await openDocument(activeFile);
    restoreMountScrollRatio(mountRoot, stored?.scrollRatio ?? null);
    state.status = `Restored ${activeFile.name}`;
    await refreshRecents();
    return true;
  }
  if (fallbackActivePath) {
    await openDocument(await readDocumentFile(fallbackActivePath));
    return true;
  }
  return false;
}

export async function readSnapshotDocumentFile(path: string): Promise<DocumentFile | null> {
  try {
    return await readDocumentFile(path);
  } catch {
    return null;
  }
}

export async function createSessionFromHotReloadSnapshot(file: DocumentFile, stored: HotReloadDocumentSnapshot | undefined): Promise<DocumentSession> {
  const workspaceAccess = workspaceFileAiAccess(file.path);
  return {
    documentId: file.path,
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: stored?.mode ?? defaultDocumentMode(file.extension, { hiddenFromAI: file.hiddenFromAI || workspaceAccess.hiddenFromAI }),
    dirty: false,
    readOnly: file.locked === true || workspaceAccess.readOnly,
    hiddenFromAI: file.hiddenFromAI === true || workspaceAccess.hiddenFromAI,
    isNew: false,
    metaOpen: stored?.metaOpen ?? false,
    document: await deserializeHvy(new Uint8Array(file.bytes), file.extension),
    chatState: null,
    scrollRatio: stored?.scrollRatio ?? null,
    viewState: null,
    recoveryState: stored?.recoveryState ?? null,
    recoveryBackupId: null,
    recoveryModified: false,
  };
}

export async function openGuide(): Promise<void> {
  await runBusy('Opening HVY Galaxy guide...', async () => {
    await openDefaultGuide({ force: true });
  });
}

export async function openHvyGuide(): Promise<void> {
  await runBusy('Opening HVY guide...', async () => {
    await openDocument(await loadIncludedDocument('hvy-guide'), { defaultDocument: true, defaultDocumentLabel: 'HVY guide', includedDocumentId: 'hvy-guide' });
  });
}
