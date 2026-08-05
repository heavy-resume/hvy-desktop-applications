import { installAiChatClient } from './aiClient';
import { installMcpClient, installPluginPackage, openColorThemeDialog, openExternalUrl, removeMcpClient, restoreMcpClientBackup, saveAiSettings, saveAppSettings, saveColorThemeAsDialog, saveMcpSettings, startMcpServer, stopMcpServer, type AiSettings, type McpClientInstallTarget } from './backend';
import { createColorThemeFile, createSavedThemeId, getMatchedSavedThemeId, getPaletteById, isCssVariableName, parseColorThemeFile, serializeColorThemeFile, saveColorThemeSettings, THEME_COLOR_NAMES } from './colorTheme';
import { clearDebugLogEntries, configureDebugLog, getDebugLogEntries } from './debugLog';
import { state } from './state';
import { applyAppColorTheme, refreshMcpClientInstallStatus, mountCurrentDocument, mountRoot, rerender, refreshDebugLogModal, runBusy, closeUiBeforeAiSettings, closeUiBeforeAbout, closeUiBeforeAppSettings, closeUiBeforeColorTheme, closeUiBeforeMcpSettings, persistAndApplyColorTheme, updateThemeRowChrome, currentThemeDisplayName, themeSuggestedFileName, cloneAiSettings, cloneAppSettings, cloneMcpSettings, aiSettingsChanged, appSettingsChanged, mcpSettingsChanged, copyMcpConnectionUrl, copyMcpBearerToken, copyMcpSetupValue, canonicalAiSettings, canonicalAppSettings, setDocumentDirty, writeDocumentColorPreference } from './main';
import type { UiHandlers } from './ui';
import { refreshInstalledPlugins } from './pluginManager';
import { controlIntegrationBrowser, openIntegrationBrowser, openIntegrationPage, runIntegrationStorageProbe } from './integrationBrowser';
import { loadIntegrationVaultStatus, resetIntegrationVault } from './backend';
import { actionPatternPayload, createCustomPageIntegration, createIntegrationProfile, matcherSnapshot, matchingInspectionPrivacyRules, saveIntegrationRegistry, type IntegrationActionDefinition } from './integrationRegistry';

interface DocumentColorTheme {
  name: string;
  colors: Record<string, string>;
}

function integrationDestinationLabel(destination: 'msn' | 'gmail' | 'calendar'): string {
  if (destination === 'msn') return 'MSN image test';
  return destination === 'gmail' ? 'Gmail' : 'Google Calendar';
}

async function persistAiSettings(settings: AiSettings): Promise<void> {
  state.aiSettings = await saveAiSettings(settings);
  installAiChatClient(state.aiSettings, state.appSettings);
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.aiSettingsDiscardDialogOpen = false;
  state.aiSettingsSelectedProviderId = null;
  state.status = 'Saved AI settings';
}

function currentDocumentColorTheme(): DocumentColorTheme {
  const theme = state.document?.mounted?.document.meta.theme;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return { name: '', colors: {} };
  const record = theme as { name?: unknown; colors?: unknown };
  const colors = record.colors && typeof record.colors === 'object' && !Array.isArray(record.colors)
    ? Object.fromEntries(Object.entries(record.colors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};
  return {
    name: typeof record.name === 'string' ? record.name : '',
    colors,
  };
}

function updateDocumentColorTheme(nextTheme: DocumentColorTheme): void {
  const document = state.document?.mounted?.document;
  if (!document) return;
  const meta = document.meta as Record<string, unknown>;
  meta.theme = {
    name: nextTheme.name,
    colors: nextTheme.colors,
  };
  applyAppColorTheme();
  if (state.document?.virtual === 'defaultDocument') {
    state.status = 'Previewed document colors';
  } else {
    setDocumentDirty(true);
    state.status = 'Updated document colors';
  }
}

function initializeDocumentColorThemeFromCurrentTheme(): void {
  const current = currentDocumentColorTheme();
  applyAppColorTheme();
  const computed = window.getComputedStyle(mountRoot ?? document.documentElement);
  const colors = Object.fromEntries(THEME_COLOR_NAMES
    .map((name) => [name, computed.getPropertyValue(name).trim()] as const)
    .filter((entry) => entry[1].length > 0));
  updateDocumentColorTheme({
    name: current.name || currentThemeDisplayName() || 'Document Theme',
    colors: { ...colors, ...current.colors },
  });
}

function editingDocumentColorTheme(): boolean {
  return state.colorThemeDialogMode === 'document';
}

export function createSettingsHandlers(): Partial<UiHandlers> {
  const openAppSettings = (mode: 'settings' | 'plugins') => void runBusy('Scanning plugins...', async () => {
    await refreshInstalledPlugins();
    closeUiBeforeAppSettings();
    state.appSettingsDialogMode = mode;
    state.appSettingsDraft = cloneAppSettings(state.appSettings);
    state.appSettingsDialogInitialJson = JSON.stringify(canonicalAppSettings(state.appSettingsDraft));
    state.appSettingsDiscardDialogOpen = false;
    state.appSettingsDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  });
  const persistIntegrationAction = () => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationActionDraftIntegrationId);
    if (!integration || !state.integrationActionDraftPageId) throw new Error('Action integration was not found.');
    const name = state.integrationActionDraftName.trim();
    if (!name) throw new Error('Give the action a name.');
    const fields = state.integrationActionExamples.map((snapshot, index) => ({
      id: `field-${crypto.randomUUID()}`,
      label: state.integrationActionTargetLabels[index].trim(),
      cardinality: state.integrationActionTargetCardinalities[index] ?? 'single',
      optional: state.integrationActionTargetOptional[index] ?? true,
      snapshot: matcherSnapshot(snapshot),
      snapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).filter(Boolean).map(matcherSnapshot),
      negativeSnapshots: (state.integrationActionTargetNegativeVariants[index] ?? []).filter(Boolean).map(matcherSnapshot),
    }));
    integration.actions.push({
      id: `action-${crypto.randomUUID()}`,
      integrationId: integration.id,
      name,
      description: state.integrationActionDraftDescription.trim(),
      pageIds: [state.integrationActionDraftPageId],
      script: 'structural-pattern-v1',
      resultSchema: {
        type: 'array',
        items: { type: 'object', properties: Object.fromEntries(fields.map((field) => [field.label, { type: field.cardinality === 'list' ? 'array' : 'string' }])) },
      },
      permissions: ['dom:read'],
      version: 1,
      status: 'ready',
      pattern: {
        recordLabel: name,
        minimumConfidence: state.integrationActionMinimumConfidence,
        parents: state.integrationActionAnchors.map(matcherSnapshot),
        fields,
      },
    });
    saveIntegrationRegistry(state.integrationRegistry);
    state.integrationActionBuilderOpen = false;
    state.status = `Saved ${name}`;
    rerender({ preserveMountedDocument: true });
  };
  return {
  openIntegrations: () => {
    state.integrationsDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    void runBusy('Checking secure integration storage...', async () => {
      state.integrationVaultStatus = await loadIntegrationVaultStatus();
      state.status = 'Ready';
    }, { preserveMountedDocument: true });
  },
  closeIntegrations: () => {
    state.integrationsDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  requestAddIntegrationPage: () => {
    state.addIntegrationPageDialogOpen = true;
    rerender({ preserveMountedDocument: true });
  },
  cancelAddIntegrationPage: () => {
    state.addIntegrationPageDialogOpen = false;
    rerender({ preserveMountedDocument: true });
  },
  addIntegrationPage: (name, url) => {
    const integration = createCustomPageIntegration(name, url);
    const profile = createIntegrationProfile(integration.profileProviderId, `${integration.name} profile`);
    state.integrationRegistry = {
      ...state.integrationRegistry,
      integrations: [...state.integrationRegistry.integrations, integration],
      profiles: [...state.integrationRegistry.profiles, profile],
    };
    state.selectedIntegrationId = integration.id;
    state.selectedIntegrationProfileId = profile.id;
    saveIntegrationRegistry(state.integrationRegistry);
    state.addIntegrationPageDialogOpen = false;
    state.status = `Added ${integration.name}`;
    rerender({ preserveMountedDocument: true });
  },
  selectIntegration: (integrationId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    if (!integration) throw new Error('Integration was not found.');
    state.selectedIntegrationId = integration.id;
    state.selectedIntegrationProfileId = state.integrationRegistry.profiles.find((profile) => profile.providerId === integration.profileProviderId)?.id ?? '';
    rerender({ preserveMountedDocument: true });
  },
  selectIntegrationProfile: (profileId) => {
    state.selectedIntegrationProfileId = profileId;
    rerender({ preserveMountedDocument: true });
  },
  requestAddIntegrationProfile: () => {
    state.addIntegrationProfileDialogOpen = true;
    rerender({ preserveMountedDocument: true });
  },
  cancelAddIntegrationProfile: () => {
    state.addIntegrationProfileDialogOpen = false;
    rerender({ preserveMountedDocument: true });
  },
  addIntegrationProfile: (name) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.selectedIntegrationId);
    if (!integration) throw new Error('Integration was not found.');
    const profile = createIntegrationProfile(integration.profileProviderId, name);
    state.integrationRegistry = { ...state.integrationRegistry, profiles: [...state.integrationRegistry.profiles, profile] };
    saveIntegrationRegistry(state.integrationRegistry);
    state.selectedIntegrationProfileId = profile.id;
    state.addIntegrationProfileDialogOpen = false;
    state.status = `Added ${profile.name}`;
    rerender({ preserveMountedDocument: true });
  },
  openIntegrationPage: (integrationId, pageId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error('Integration page was not found.');
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!profile || profile.providerId !== integration?.profileProviderId) throw new Error('Choose an integration profile.');
    if (page.id === 'gmail' || page.id === 'google-calendar') {
      const destination = page.id === 'gmail' ? 'gmail' : 'calendar';
      void runBusy(`Opening ${page.name}...`, async () => {
        await openIntegrationBrowser(destination, profile.id, profile.browserStoreId);
        state.integrationVaultStatus = await loadIntegrationVaultStatus();
        state.status = `Opened ${page.name}`;
      }, { preserveMountedDocument: true });
      return;
    }
    void runBusy(`Opening ${page.name}...`, async () => {
      await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId);
      state.integrationVaultStatus = await loadIntegrationVaultStatus();
      state.status = `Opened ${page.name}`;
    }, { preserveMountedDocument: true });
  },
  addActionForIntegrationPage: (integrationId, pageId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error('Integration page was not found.');
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!profile || profile.providerId !== integration?.profileProviderId) throw new Error('Choose an integration profile.');
    state.integrationActionDraftIntegrationId = integrationId;
    state.integrationActionDraftPageId = pageId;
    state.integrationActionExamples = [];
    state.integrationActionExampleRules = [];
    state.integrationActionTargetLabels = [];
    state.integrationActionTargetCardinalities = [];
    state.integrationActionTargetOptional = [];
    state.integrationActionTargetParentIndexes = [];
    state.integrationActionTargetSelectionParentIndex = 0;
    state.integrationActionTargetSelectionFieldIndex = null;
    state.integrationActionTargetVariants = [];
    state.integrationActionTargetNegativeVariants = [];
    state.integrationActionTargetAbsentExamples = [];
    state.integrationActionSelectedParentIndex = 0;
    state.integrationActionMinimumConfidence = 0.8;
    state.integrationActionAnchors = [];
    state.integrationActionAnchorRules = [];
    state.integrationActionSelectionKind = 'parent';
    state.integrationActionSelectionPending = true;
    state.integrationActionBuilderStep = 'define';
    state.integrationActionDraftName = '';
    state.integrationActionDraftDescription = '';
    state.integrationActionPreviewRecords = [];
    state.integrationActionPreviewDiagnostics = null;
    state.integrationActionBuilderOpen = true;
    state.integrationInspectionResult = null;
    void runBusy(`Opening ${page.name} for action selection...`, async () => {
      if (page.id === 'gmail' || page.id === 'google-calendar') {
        await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, true);
      } else {
        await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, true);
      }
      state.status = `Select the ${page.name} content this action should use`;
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', profile.id));
  },
  closeIntegrationActionBuilder: () => {
    if (state.integrationActionSelectionPending) {
      void controlIntegrationBrowser('cancel-inspect', state.selectedIntegrationProfileId);
    }
    if (state.integrationActionAnchors.length || state.integrationActionExamples.length) {
      state.integrationActionDiscardDialogOpen = true;
    } else {
      state.integrationActionSelectionPending = false;
      state.integrationActionBuilderOpen = false;
    }
    rerender({ preserveMountedDocument: true });
  },
  cancelDiscardIntegrationAction: () => {
    state.integrationActionDiscardDialogOpen = false;
    rerender({ preserveMountedDocument: true });
  },
  confirmDiscardIntegrationAction: () => {
    state.integrationActionDiscardDialogOpen = false;
    state.integrationActionSelectionPending = false;
    state.integrationActionBuilderOpen = false;
    rerender({ preserveMountedDocument: true });
  },
  cancelIntegrationActionSelection: () => {
    void controlIntegrationBrowser('cancel-inspect', state.selectedIntegrationProfileId);
    state.integrationActionSelectionPending = false;
    state.status = 'Canceled page selection';
    rerender({ preserveMountedDocument: true });
  },
  addAnotherIntegrationActionExample: (parentIndex = 0, fieldIndex = null) => {
    state.integrationActionBuilderOpen = true;
    state.integrationActionBuilderStep = 'define';
    state.integrationActionSelectionKind = 'target';
    state.integrationActionTargetSelectionParentIndex = parentIndex;
    state.integrationActionTargetSelectionFieldIndex = fieldIndex;
    state.integrationActionSelectedParentIndex = parentIndex;
    state.integrationActionSelectionPending = true;
    void runBusy('Starting another selection...', async () => {
      const parentSnapshot = state.integrationActionAnchors[parentIndex];
      const parentCssPath = (parentSnapshot as { selected?: { cssPath?: string } } | undefined)?.selected?.cssPath;
      await controlIntegrationBrowser('inspect-target', state.selectedIntegrationProfileId, { parentCssPath, parentSnapshot });
      state.status = 'Select data inside the parent';
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', state.selectedIntegrationProfileId));
  },
  addIntegrationActionAnchor: () => {
    state.integrationActionBuilderOpen = true;
    state.integrationActionBuilderStep = 'define';
    state.integrationActionSelectionKind = 'example';
    state.integrationActionSelectionPending = true;
    void runBusy('Starting anchor selection...', async () => {
      const targets = state.integrationActionExamples.map((snapshot, index) => ({
        label: state.integrationActionTargetLabels[index] || `Target ${index + 1}`,
        cardinality: state.integrationActionTargetCardinalities[index] ?? 'single',
        optional: state.integrationActionTargetOptional[index] ?? true,
        snapshot,
        snapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).filter(Boolean),
        negativeSnapshots: (state.integrationActionTargetNegativeVariants[index] ?? []).filter(Boolean),
      }));
      const existingPattern = targets.length
        ? { minimumConfidence: state.integrationActionMinimumConfidence, parents: state.integrationActionAnchors, targets }
        : null;
      await controlIntegrationBrowser('inspect-parent', state.selectedIntegrationProfileId, { existingPattern });
      state.status = 'Select another parent containing the same kind of data';
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', state.selectedIntegrationProfileId));
  },
  removeIntegrationActionSelection: (kind, index) => {
    if (kind === 'example') {
      state.integrationActionAnchors.splice(index, 1);
      state.integrationActionAnchorRules.splice(index, 1);
      state.integrationActionTargetVariants.forEach((variants) => variants.splice(index, 1));
      state.integrationActionTargetNegativeVariants.forEach((variants) => variants.splice(index, 1));
      state.integrationActionTargetAbsentExamples.forEach((examples) => examples.splice(index, 1));
      state.integrationActionTargetParentIndexes = state.integrationActionTargetParentIndexes.map((parentIndex) => parentIndex > index ? parentIndex - 1 : parentIndex);
      for (let fieldIndex = state.integrationActionTargetVariants.length - 1; fieldIndex >= 0; fieldIndex -= 1) {
        const replacement = state.integrationActionTargetVariants[fieldIndex].find(Boolean);
        if (replacement) {
          state.integrationActionExamples[fieldIndex] = replacement;
          state.integrationActionTargetParentIndexes[fieldIndex] = state.integrationActionTargetVariants[fieldIndex].findIndex(Boolean);
          continue;
        }
        state.integrationActionTargetVariants.splice(fieldIndex, 1);
        state.integrationActionTargetNegativeVariants.splice(fieldIndex, 1);
        state.integrationActionTargetAbsentExamples.splice(fieldIndex, 1);
        state.integrationActionExamples.splice(fieldIndex, 1);
        state.integrationActionExampleRules.splice(fieldIndex, 1);
        state.integrationActionTargetLabels.splice(fieldIndex, 1);
        state.integrationActionTargetCardinalities.splice(fieldIndex, 1);
        state.integrationActionTargetOptional.splice(fieldIndex, 1);
        state.integrationActionTargetParentIndexes.splice(fieldIndex, 1);
      }
      state.integrationActionSelectedParentIndex = Math.min(state.integrationActionSelectedParentIndex, state.integrationActionAnchors.length - 1);
    } else {
      state.integrationActionExamples.splice(index, 1);
      state.integrationActionExampleRules.splice(index, 1);
      state.integrationActionTargetLabels.splice(index, 1);
      state.integrationActionTargetCardinalities.splice(index, 1);
      state.integrationActionTargetOptional.splice(index, 1);
      state.integrationActionTargetParentIndexes.splice(index, 1);
      state.integrationActionTargetVariants.splice(index, 1);
      state.integrationActionTargetNegativeVariants.splice(index, 1);
      state.integrationActionTargetAbsentExamples.splice(index, 1);
    }
    const useParent = state.integrationActionAnchors.length > 0;
    const nextItems = useParent ? state.integrationActionAnchors : state.integrationActionExamples;
    const nextRules = useParent ? state.integrationActionAnchorRules : state.integrationActionExampleRules;
    state.integrationActionSelectionKind = useParent ? 'example' : 'target';
    state.integrationInspectionResult = nextItems.at(-1) ?? null;
    state.inspectionPrivacyRules = nextRules.at(-1) ? [...nextRules.at(-1)!] : [];
    rerender({ preserveMountedDocument: true });
  },
  reviewIntegrationActionSelection: (kind, index) => {
    const items = kind === 'example' ? state.integrationActionAnchors : state.integrationActionExamples;
    const rules = kind === 'example' ? state.integrationActionAnchorRules : state.integrationActionExampleRules;
    state.integrationActionSelectionKind = kind;
    state.integrationInspectionResult = items[index] ?? null;
    state.inspectionPrivacyRules = [...(rules[index] ?? [])];
    state.integrationActionBuilderStep = 'define';
    rerender({ preserveMountedDocument: true });
  },
  updateIntegrationTargetLabel: (index, label) => {
    state.integrationActionTargetLabels[index] = label;
  },
  updateIntegrationTargetCardinality: (index, cardinality) => {
    state.integrationActionTargetCardinalities[index] = cardinality;
  },
  updateIntegrationTargetOptional: (index, optional) => {
    state.integrationActionTargetOptional[index] = optional;
  },
  setIntegrationTargetAbsent: (fieldIndex, parentIndex, absent) => {
    if (absent) {
      state.integrationActionTargetNegativeVariants[fieldIndex][parentIndex] = state.integrationActionTargetVariants[fieldIndex][parentIndex] ?? null;
      state.integrationActionTargetVariants[fieldIndex][parentIndex] = null;
      state.integrationActionTargetAbsentExamples[fieldIndex][parentIndex] = true;
      state.integrationActionTargetOptional[fieldIndex] = true;
    } else {
      state.integrationActionTargetAbsentExamples[fieldIndex][parentIndex] = false;
      state.integrationActionTargetNegativeVariants[fieldIndex][parentIndex] = null;
    }
    const replacement = state.integrationActionTargetVariants[fieldIndex].find(Boolean);
    if (replacement) state.integrationActionExamples[fieldIndex] = replacement;
    rerender({ preserveMountedDocument: true });
  },
  selectIntegrationActionExample: (index) => {
    state.integrationActionSelectedParentIndex = index;
    rerender({ preserveMountedDocument: true });
  },
  updateIntegrationActionMinimumConfidence: (value) => {
    state.integrationActionMinimumConfidence = Math.max(0.7, Math.min(0.95, value));
  },
  testIntegrationActionPattern: () => {
    const targets = state.integrationActionExamples.map((snapshot, index) => ({ label: state.integrationActionTargetLabels[index] || `Target ${index + 1}`, cardinality: state.integrationActionTargetCardinalities[index] ?? 'single', optional: state.integrationActionTargetOptional[index] ?? true, snapshot, snapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).filter(Boolean), negativeSnapshots: (state.integrationActionTargetNegativeVariants[index] ?? []).filter(Boolean) }));
    void controlIntegrationBrowser('test-pattern', state.selectedIntegrationProfileId, { minimumConfidence: state.integrationActionMinimumConfidence, parents: state.integrationActionAnchors, targets }).then(() => {
      state.status = 'Highlighted structural pattern matches';
    });
  },
  previewIntegrationAction: () => {
    const targets = state.integrationActionExamples.map((snapshot, index) => ({
      label: state.integrationActionTargetLabels[index],
      cardinality: state.integrationActionTargetCardinalities[index] ?? 'single',
      optional: state.integrationActionTargetOptional[index] ?? true,
      snapshot,
      snapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).filter(Boolean),
      negativeSnapshots: (state.integrationActionTargetNegativeVariants[index] ?? []).filter(Boolean),
    }));
    state.integrationActionPreviewDiagnostics = null;
    state.integrationActionBuilderOpen = false;
    void runBusy('Extracting page data...', async () => {
      await controlIntegrationBrowser('extract-pattern', state.selectedIntegrationProfileId, {
        pattern: { minimumConfidence: state.integrationActionMinimumConfidence, parents: state.integrationActionAnchors, targets },
        context: { mode: 'builder' },
      });
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', state.selectedIntegrationProfileId));
  },
  continueIntegrationActionBuilder: () => {
    state.integrationActionBuilderStep = 'save';
    rerender({ preserveMountedDocument: true });
  },
  backIntegrationActionBuilder: () => {
    state.integrationActionBuilderStep = state.integrationActionBuilderStep === 'save' ? 'preview' : 'define';
    rerender({ preserveMountedDocument: true });
  },
  reviewIntegrationActionRequest: (name, description) => {
    state.integrationActionDraftName = name.trim();
    state.integrationActionDraftDescription = description.trim();
    persistIntegrationAction();
  },
  saveIntegrationActionDraft: () => {
    persistIntegrationAction();
  },
  runIntegrationAction: (integrationId, actionId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const action = integration?.actions.find((candidate) => candidate.id === actionId) as IntegrationActionDefinition | undefined;
    const page = integration?.pages.find((candidate) => candidate.id === action?.pageIds[0]);
    const pattern = action && actionPatternPayload(action);
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!integration || !action || !page || !pattern || !profile) throw new Error('The saved action is incomplete.');
    void runBusy(`Running ${action.name}...`, async () => {
      const extraction = { pattern, context: { mode: 'saved-action', actionId: action.id, actionName: action.name, expectedOrigin: new URL(page.url).origin } };
      if (page.id === 'gmail' || page.id === 'google-calendar') {
        await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, extraction);
      } else {
        await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, extraction);
      }
    }, { preserveMountedDocument: true });
  },
  closeIntegrationActionResult: () => {
    state.integrationActionResultOpen = false;
    state.integrationActionResultRecords = [];
    rerender({ preserveMountedDocument: true });
  },
  setInspectionPrivacyRule: (path, action, label) => {
    const relatedPaths = new Set(matchingInspectionPrivacyRules(state.integrationInspectionResult, path, 'remove').map((rule) => rule.path));
    state.inspectionPrivacyRules = state.inspectionPrivacyRules.filter((rule) => !relatedPaths.has(rule.path));
    if (action !== 'keep') {
      const matchingRules = matchingInspectionPrivacyRules(state.integrationInspectionResult, path, action, action === 'label' ? label || 'REDACTED' : undefined);
      const matchingPaths = new Set(matchingRules.map((rule) => rule.path));
      state.inspectionPrivacyRules = state.inspectionPrivacyRules.filter((rule) => !matchingPaths.has(rule.path));
      state.inspectionPrivacyRules.push(...matchingRules);
    }
    if (state.integrationActionSelectionKind === 'example') state.integrationActionAnchorRules[state.integrationActionAnchorRules.length - 1] = [...state.inspectionPrivacyRules];
    else state.integrationActionExampleRules[state.integrationActionExampleRules.length - 1] = [...state.inspectionPrivacyRules];
  },
  updateInspectionPrivacyLabel: (path, label) => {
    const relatedPaths = new Set(matchingInspectionPrivacyRules(state.integrationInspectionResult, path, 'remove').map((rule) => rule.path));
    state.inspectionPrivacyRules = state.inspectionPrivacyRules.filter((rule) => !relatedPaths.has(rule.path));
    if (label.trim()) {
      const matchingRules = matchingInspectionPrivacyRules(state.integrationInspectionResult, path, 'label', label.trim());
      const matchingPaths = new Set(matchingRules.map((rule) => rule.path));
      state.inspectionPrivacyRules = state.inspectionPrivacyRules.filter((rule) => !matchingPaths.has(rule.path));
      state.inspectionPrivacyRules.push(...matchingRules);
    }
    if (state.integrationActionSelectionKind === 'example') state.integrationActionAnchorRules[state.integrationActionAnchorRules.length - 1] = [...state.inspectionPrivacyRules];
    else state.integrationActionExampleRules[state.integrationActionExampleRules.length - 1] = [...state.inspectionPrivacyRules];
  },
  openIntegration: (destination) => void runBusy(`Opening ${integrationDestinationLabel(destination)}...`, async () => {
    await openIntegrationBrowser(destination);
    state.integrationVaultStatus = await loadIntegrationVaultStatus();
    state.status = `Opened ${integrationDestinationLabel(destination)}`;
  }, { preserveMountedDocument: true }),
  controlIntegrationBrowser: (command) => void runBusy(command === 'inspect' ? 'Starting action inspection...' : `${command === 'close' ? 'Closing' : 'Updating'} integration browser...`, async () => {
    await controlIntegrationBrowser(command, state.selectedIntegrationProfileId);
    state.status = command === 'inspect' ? 'Select content in the open integration page' : command === 'close' ? 'Closed integration browser' : 'Updated integration browser';
  }, { preserveMountedDocument: true }),
  probeIntegrationStorage: () => void runBusy('Testing integration cookie storage...', async () => {
    state.integrationStorageProbeResult = await runIntegrationStorageProbe();
    const result = state.integrationStorageProbeResult;
    state.status = result.extracted && result.freshStoreEmpty && result.restored && result.deleted
      ? 'Ephemeral integration cookie round trip passed'
      : 'Ephemeral integration cookie round trip failed';
  }, { preserveMountedDocument: true }),
  requestResetIntegrationVault: () => {
    state.integrationVaultResetDialogOpen = true;
    rerender({ preserveMountedDocument: true });
  },
  cancelResetIntegrationVault: () => {
    state.integrationVaultResetDialogOpen = false;
    rerender({ preserveMountedDocument: true });
  },
  confirmResetIntegrationVault: () => void runBusy('Resetting integrations...', async () => {
    state.integrationVaultStatus = await resetIntegrationVault();
    state.integrationVaultResetDialogOpen = false;
    state.integrationStorageProbeResult = null;
    state.status = 'Reset integrations';
  }, { preserveMountedDocument: true }),
  openAppSettings: () => openAppSettings('settings'),
  openPluginManager: () => openAppSettings('plugins'),
  installPluginFiles: (files, settings) => void runBusy('Installing plugins...', async () => {
    state.appSettingsDraft = settings;
    for (const file of files) {
      await installPluginPackage(file.name, Array.from(new Uint8Array(await file.arrayBuffer())));
    }
    await refreshInstalledPlugins();
    state.status = files.length === 1 ? `Installed ${files[0].name}` : `Installed ${files.length} plugins`;
    rerender({ preserveMountedDocument: true });
  }),
  saveAppSettings: (settings) => void runBusy('Saving settings...', async () => {
    state.appSettings = await saveAppSettings(settings);
    configureDebugLog({ maxBytes: state.appSettings.debugLogMaxBytes });
    installAiChatClient(state.aiSettings, state.appSettings);
    state.appSettingsDialogOpen = false;
    state.appSettingsDraft = null;
    state.appSettingsDialogInitialJson = null;
    state.appSettingsDiscardDialogOpen = false;
    state.status = 'Saved settings';
    await mountCurrentDocument();
  }),
  cancelAppSettings: (settings) => {
    if (appSettingsChanged(settings)) {
      state.appSettingsDiscardDialogOpen = true;
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.appSettingsDialogOpen = false;
    state.appSettingsDraft = null;
    state.appSettingsDialogInitialJson = null;
    state.appSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  discardAppSettingsChanges: () => {
    state.appSettingsDialogOpen = false;
    state.appSettingsDraft = null;
    state.appSettingsDialogInitialJson = null;
    state.appSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  keepEditingAppSettings: () => {
    state.appSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openScriptingReview: () => {
    state.scriptingReviewDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeScriptingReview: () => {
    state.scriptingReviewDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  setWholeFilePowerScriptingAllowed: (path, allowed) => void runBusy('Updating power scripting approvals...', async () => {
    const allowedFiles = new Set(state.appSettings.powerScriptingAllowedFiles);
    if (allowed) allowedFiles.add(path);
    else allowedFiles.delete(path);
    state.appSettings = await saveAppSettings({
      ...state.appSettings,
      powerScriptingAllowedFiles: [...allowedFiles],
    });
    state.status = allowed ? 'Allowed power scripting for file' : 'Revoked whole-file power scripting';
    rerender({ preserveMountedDocument: true });
  }),
  revokePowerScriptAcceptance: (path, fingerprint) => void runBusy('Revoking power script approval...', async () => {
    const fingerprints = (state.appSettings.powerScriptAcceptances[path] ?? [])
      .filter((candidate) => candidate !== fingerprint);
    const powerScriptAcceptances = { ...state.appSettings.powerScriptAcceptances };
    if (fingerprints.length > 0) powerScriptAcceptances[path] = fingerprints;
    else delete powerScriptAcceptances[path];
    const fileAcceptanceScripts = Object.fromEntries(
      Object.entries(state.appSettings.powerScriptAcceptanceScripts[path] ?? {})
        .filter(([candidate]) => candidate !== fingerprint),
    );
    const powerScriptAcceptanceScripts = { ...state.appSettings.powerScriptAcceptanceScripts };
    if (Object.keys(fileAcceptanceScripts).length > 0) powerScriptAcceptanceScripts[path] = fileAcceptanceScripts;
    else delete powerScriptAcceptanceScripts[path];
    state.appSettings = await saveAppSettings({
      ...state.appSettings,
      powerScriptAcceptances,
      powerScriptAcceptanceScripts,
    });
    state.status = 'Revoked power script approval';
    rerender({ preserveMountedDocument: true });
  }),
  openAbout: () => {
    closeUiBeforeAbout();
    state.aboutDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeAbout: () => {
    state.aboutDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openDebugLog: () => {
    closeUiBeforeAbout();
    state.debugLogDialogOpen = true;
    state.debugLogEntries = getDebugLogEntries();
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeDebugLog: () => {
    state.debugLogDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  refreshDebugLog: () => {
    refreshDebugLogModal();
  },
  clearDebugLog: () => {
    clearDebugLogEntries();
    refreshDebugLogModal();
  },
  saveDebugLogSettings: (settings) => void runBusy('Saving debug settings...', async () => {
    state.appSettings = await saveAppSettings(settings);
    configureDebugLog({ maxBytes: state.appSettings.debugLogMaxBytes });
    installAiChatClient(state.aiSettings, state.appSettings);
    state.debugLogEntries = getDebugLogEntries();
    state.status = 'Saved debug settings';
  }, { preserveMountedDocument: true }),
  openAiSettings: () => {
    closeUiBeforeAiSettings();
    state.aiSettingsDraft = cloneAiSettings(state.aiSettings);
    state.aiSettingsDialogInitialJson = JSON.stringify(canonicalAiSettings(state.aiSettingsDraft));
    state.aiSettingsDiscardDialogOpen = false;
    state.aiSettingsSelectedProviderId = state.aiSettingsDraft.activeProviderId;
    state.aiSettingsDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  selectAiProvider: (providerId, settings) => {
    state.aiSettingsDraft = settings;
    state.aiSettingsSelectedProviderId = providerId;
    rerender({ preserveMountedDocument: true });
  },
  setDefaultAiProvider: (settings) => {
    state.aiSettingsDraft = settings;
    state.aiSettingsSelectedProviderId = settings.activeProviderId;
    rerender({ preserveMountedDocument: true });
  },
  openProviderDocs: (url) => {
    void openExternalUrl(url)
      .then(() => {
        state.status = 'Opened setup instructions';
      })
      .catch((error) => {
        state.error = error instanceof Error ? error.message : String(error);
        state.status = 'Ready';
        rerender();
        void mountCurrentDocument();
      });
  },
  saveAiSettings: (settings) => {
    void runBusy('Saving AI settings...', async () => {
      await persistAiSettings(settings);
    });
  },
  cancelAiSettings: (settings) => {
    if (aiSettingsChanged(settings)) {
      state.aiSettingsDiscardDialogOpen = true;
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.aiSettingsDiscardDialogOpen = false;
    state.aiSettingsSelectedProviderId = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  discardAiSettingsChanges: () => {
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.aiSettingsDiscardDialogOpen = false;
    state.aiSettingsSelectedProviderId = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  keepEditingAiSettings: () => {
    state.aiSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openMcpSettings: () => {
    closeUiBeforeMcpSettings();
    state.mcpSettingsDraft = cloneMcpSettings(state.mcpSettings);
    state.mcpSettingsDialogInitialJson = JSON.stringify(state.mcpSettingsDraft);
    state.mcpSettingsDialogOpen = true;
    state.mcpSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    void refreshMcpClientInstallStatus();
  },
  saveMcpSettings: (settings) => void runBusy('Saving MCP settings...', async () => {
    state.mcpSettings = await saveMcpSettings(settings);
    state.mcpSettingsDialogOpen = false;
    state.mcpSettingsDraft = null;
    state.mcpSettingsDialogInitialJson = null;
    state.mcpSettingsDiscardDialogOpen = false;
    state.status = 'Saved MCP settings';
  }),
  cancelMcpSettings: (settings) => {
    if (mcpSettingsChanged(settings)) {
      state.mcpSettingsDiscardDialogOpen = true;
      rerender({ preserveMountedDocument: true });
      return;
    }
    state.mcpSettingsDialogOpen = false;
    state.mcpSettingsDraft = null;
    state.mcpSettingsDialogInitialJson = null;
    state.mcpSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  discardMcpSettingsChanges: () => {
    state.mcpSettingsDialogOpen = false;
    state.mcpSettingsDraft = null;
    state.mcpSettingsDialogInitialJson = null;
    state.mcpSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  keepEditingMcpSettings: () => {
    state.mcpSettingsDiscardDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  startMcpServer: () => void runBusy('Starting MCP server...', async () => {
    state.mcpServerStatus = await startMcpServer();
    state.status = state.mcpServerStatus.message;
  }),
  stopMcpServer: () => void runBusy('Stopping MCP server...', async () => {
    state.mcpServerStatus = await stopMcpServer();
    state.status = state.mcpServerStatus.message;
  }),
  restartMcpServer: () => void runBusy('Restarting MCP server...', async () => {
    await stopMcpServer();
    state.mcpServerStatus = await startMcpServer();
    state.status = state.mcpServerStatus.message;
  }),
  installMcpClient: (target: McpClientInstallTarget) => void runBusy('Installing MCP client config...', async () => {
    state.mcpClientInstallStatus = await installMcpClient(target);
    const client = state.mcpClientInstallStatus.find((status) => status.target === target);
    state.status = client?.message ?? 'Installed MCP client config';
  }),
  removeMcpClient: (target: McpClientInstallTarget) => void runBusy('Removing MCP client config...', async () => {
    state.mcpClientInstallStatus = await removeMcpClient(target);
    const client = state.mcpClientInstallStatus.find((status) => status.target === target);
    state.status = client?.message ?? 'Removed MCP client config';
  }),
  restoreMcpClientBackup: (target: McpClientInstallTarget) => void runBusy('Restoring MCP client config...', async () => {
    state.mcpClientInstallStatus = await restoreMcpClientBackup(target);
    const client = state.mcpClientInstallStatus.find((status) => status.target === target);
    state.status = client?.message ?? 'Restored MCP client config backup';
  }),
  copyMcpConnectionUrl: (url) => void copyMcpConnectionUrl(url),
  copyMcpBearerToken: (token) => void copyMcpBearerToken(token),
  copyMcpSetupValue: (value, label) => void copyMcpSetupValue(value, label),
  openColorTheme: () => {
    closeUiBeforeColorTheme();
    state.colorThemeDialogOpen = true;
    state.colorThemeDialogMode = 'global';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  openDocumentColorTheme: () => {
    closeUiBeforeColorTheme();
    initializeDocumentColorThemeFromCurrentTheme();
    state.colorThemeDialogOpen = true;
    state.colorThemeDialogMode = 'document';
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeColorTheme: () => {
    state.colorThemeDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  updateColorThemeName: (name) => {
    if (editingDocumentColorTheme()) {
      updateDocumentColorTheme({ ...currentDocumentColorTheme(), name });
      return;
    }
    state.colorTheme = { ...state.colorTheme, themeName: name };
    saveColorThemeSettings(state.colorTheme);
  },
  setDocumentColorsEnabled: (enabled) => {
    writeDocumentColorPreference(state.document?.path ?? '', enabled);
    applyAppColorTheme();
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  saveColorTheme: () => {
    const name = state.colorTheme.themeName.trim() || currentThemeDisplayName() || 'Untitled Theme';
    const matchedThemeId = getMatchedSavedThemeId(state.colorTheme.colors, state.colorTheme.savedThemes);
    const now = Date.now();
    const savedThemes = [...state.colorTheme.savedThemes];
    const existingIndex = savedThemes.findIndex((theme) => theme.id === matchedThemeId || theme.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    if (existingIndex >= 0) {
      savedThemes[existingIndex] = { ...savedThemes[existingIndex], name, colors: { ...state.colorTheme.colors }, lastUsedAt: now };
    } else {
      savedThemes.push({ id: createSavedThemeId(), name, colors: { ...state.colorTheme.colors }, lastUsedAt: now });
    }
    state.colorTheme = { ...state.colorTheme, themeName: name, savedThemes };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  exportColorTheme: () => void runBusy('Exporting theme...', async () => {
    const theme = createColorThemeFile(state.colorTheme.themeName || currentThemeDisplayName() || 'Untitled Theme', state.colorTheme.colors);
    const bytes = Array.from(new TextEncoder().encode(serializeColorThemeFile(theme)));
    await saveColorThemeAsDialog({ suggestedName: themeSuggestedFileName(theme.name), bytes });
    state.colorThemeDialogOpen = true;
    state.status = `Exported theme ${theme.name}`;
  }),
  importColorTheme: () => void runBusy('Importing theme...', async () => {
    const file = await openColorThemeDialog();
    if (!file) {
      state.colorThemeDialogOpen = true;
      return;
    }
    const theme = parseColorThemeFile(new TextDecoder().decode(new Uint8Array(file.bytes)));
    const now = Date.now();
    const savedThemes = [...state.colorTheme.savedThemes];
    const existingIndex = savedThemes.findIndex((saved) => saved.name.localeCompare(theme.name, undefined, { sensitivity: 'accent' }) === 0);
    if (existingIndex >= 0) {
      savedThemes[existingIndex] = { ...savedThemes[existingIndex], colors: theme.colors, lastUsedAt: now };
    } else {
      savedThemes.push({ id: createSavedThemeId(), name: theme.name, colors: theme.colors, lastUsedAt: now });
    }
    state.colorTheme = {
      colors: theme.colors,
      themeName: theme.name,
      savedThemes,
      themeUses: state.colorTheme.themeUses,
      overrideDocumentColors: state.colorTheme.overrideDocumentColors,
    };
    persistAndApplyColorTheme();
    state.colorThemeDialogOpen = true;
    state.status = `Imported theme ${theme.name}`;
  }),
  selectColorTheme: (id) => {
    const now = Date.now();
    if (editingDocumentColorTheme()) {
      const current = currentDocumentColorTheme();
      if (id === 'default') {
        updateDocumentColorTheme({ ...current, colors: {}, name: 'Default' });
        rerender({ preserveMountedDocument: true });
        return;
      }
      if (id.startsWith('palette:')) {
        const palette = getPaletteById(id.slice('palette:'.length));
        if (!palette) return;
        updateDocumentColorTheme({ ...current, colors: { ...palette.colors }, name: palette.name });
        rerender({ preserveMountedDocument: true });
        return;
      }
      if (id.startsWith('custom:')) {
        const theme = state.colorTheme.savedThemes.find((item) => item.id === id.slice('custom:'.length));
        if (!theme) return;
        updateDocumentColorTheme({ ...current, colors: { ...theme.colors }, name: theme.name });
        rerender({ preserveMountedDocument: true });
        return;
      }
    }
    if (id === 'default') {
      state.colorTheme = {
        ...state.colorTheme,
        colors: {},
        themeName: 'Default',
        themeUses: { ...state.colorTheme.themeUses, default: now },
      };
    } else if (id.startsWith('palette:')) {
      const palette = getPaletteById(id.slice('palette:'.length));
      if (!palette) return;
      state.colorTheme = {
        ...state.colorTheme,
        colors: { ...palette.colors },
        themeName: palette.name,
        themeUses: { ...state.colorTheme.themeUses, [id]: now },
      };
    } else if (id.startsWith('custom:')) {
      const themeId = id.slice('custom:'.length);
      const savedThemes = state.colorTheme.savedThemes.map((theme) => theme.id === themeId ? { ...theme, lastUsedAt: now } : theme);
      const theme = savedThemes.find((item) => item.id === themeId);
      if (!theme) return;
      state.colorTheme = {
        ...state.colorTheme,
        colors: { ...theme.colors },
        themeName: theme.name,
        savedThemes,
      };
    }
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  deleteColorTheme: (id) => {
    if (!id.startsWith('custom:')) return;
    const themeId = id.slice('custom:'.length);
    state.colorTheme = {
      ...state.colorTheme,
      savedThemes: state.colorTheme.savedThemes.filter((theme) => theme.id !== themeId),
    };
    saveColorThemeSettings(state.colorTheme);
    rerender({ preserveMountedDocument: true });
  },
  updateColorTheme: (name, value) => {
    if (!isCssVariableName(name)) return;
    if (editingDocumentColorTheme()) {
      const theme = currentDocumentColorTheme();
      const next = { ...theme.colors };
      if (value.trim()) {
        next[name] = value.trim();
      } else {
        delete next[name];
      }
      updateDocumentColorTheme({ ...theme, colors: next });
      updateThemeRowChrome(name, next[name] ?? '');
      return;
    }
    const next = { ...state.colorTheme.colors };
    if (value.trim()) {
      next[name] = value.trim();
    } else {
      delete next[name];
    }
    state.colorTheme = { ...state.colorTheme, colors: next };
    persistAndApplyColorTheme();
    updateThemeRowChrome(name, next[name] ?? '');
  },
  resetColorTheme: (name) => {
    if (editingDocumentColorTheme()) {
      const theme = currentDocumentColorTheme();
      const next = { ...theme.colors };
      delete next[name];
      updateDocumentColorTheme({ ...theme, colors: next });
      rerender({ preserveMountedDocument: true });
      return;
    }
    const next = { ...state.colorTheme.colors };
    delete next[name];
    state.colorTheme = { ...state.colorTheme, colors: next };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  applyColorThemePalette: (id) => {
    const palette = id ? getPaletteById(id) : null;
    if (editingDocumentColorTheme()) {
      updateDocumentColorTheme({
        ...currentDocumentColorTheme(),
        colors: palette ? { ...palette.colors } : {},
        name: palette?.name ?? '',
      });
      rerender({ preserveMountedDocument: true });
      return;
    }
    const themeUseId = id ? `palette:${id}` : 'default';
    state.colorTheme = {
      colors: palette ? { ...palette.colors } : {},
      themeName: palette?.name ?? '',
      savedThemes: state.colorTheme.savedThemes,
      themeUses: { ...state.colorTheme.themeUses, [themeUseId]: Date.now() },
      overrideDocumentColors: state.colorTheme.overrideDocumentColors,
    };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  };
}
