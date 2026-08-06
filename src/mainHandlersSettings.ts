import { installAiChatClient } from './aiClient';
import { installMcpClient, installPluginPackage, openColorThemeDialog, openExternalUrl, removeMcpClient, restoreMcpClientBackup, saveAiSettings, saveAppSettings, saveColorThemeAsDialog, saveMcpSettings, startMcpServer, stopMcpServer, type AiSettings, type McpClientInstallTarget } from './backend';
import { createColorThemeFile, createSavedThemeId, getMatchedSavedThemeId, getPaletteById, isCssVariableName, parseColorThemeFile, serializeColorThemeFile, saveColorThemeSettings, THEME_COLOR_NAMES } from './colorTheme';
import { clearDebugLogEntries, configureDebugLog, getDebugLogEntries } from './debugLog';
import { state } from './state';
import { applyAppColorTheme, refreshMcpClientInstallStatus, mountCurrentDocument, mountRoot, rerender, refreshDebugLogModal, runBusy, closeUiBeforeAiSettings, closeUiBeforeAbout, closeUiBeforeAppSettings, closeUiBeforeColorTheme, closeUiBeforeMcpSettings, persistAndApplyColorTheme, updateThemeRowChrome, currentThemeDisplayName, themeSuggestedFileName, cloneAiSettings, cloneAppSettings, cloneMcpSettings, aiSettingsChanged, appSettingsChanged, mcpSettingsChanged, copyMcpConnectionUrl, copyMcpBearerToken, copyMcpSetupValue, canonicalAiSettings, canonicalAppSettings, setDocumentDirty, writeDocumentColorPreference } from './main';
import type { UiHandlers } from './ui';
import { refreshInstalledPlugins } from './pluginManager';
import { controlIntegrationBrowser, isIntegrationBrowserOpen, openIntegrationBrowser, openIntegrationPage, runIntegrationStorageProbe } from './integrationBrowser';
import { loadIntegrationVaultStatus, resetIntegrationVault } from './backend';
import { actionPatternPayload, commandExecutionPayload, createCustomPageIntegration, createIntegrationProfile, matcherSnapshot, matchingInspectionPrivacyRules, pageCommandExecutionPayload, saveIntegrationRegistry, type IntegrationActionDefinition, type IntegrationRetrievalSourceDefinition } from './integrationRegistry';

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
  const integrationActionDraftJson = () => JSON.stringify({
    integrationId: state.integrationActionDraftIntegrationId,
    pageId: state.integrationActionDraftPageId,
    actionId: state.integrationActionDraftActionId,
    name: state.integrationActionDraftName,
    description: state.integrationActionDraftDescription,
    minimumConfidence: state.integrationActionMinimumConfidence,
    parents: state.integrationActionAnchors,
    fields: state.integrationActionExamples,
    labels: state.integrationActionTargetLabels,
    ids: state.integrationActionTargetIds,
    cardinalities: state.integrationActionTargetCardinalities,
    optional: state.integrationActionTargetOptional,
    variants: state.integrationActionTargetVariants,
    negativeVariants: state.integrationActionTargetNegativeVariants,
    absentExamples: state.integrationActionTargetAbsentExamples,
  });
  const integrationActionPageContext = () => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationActionDraftIntegrationId);
    const page = integration?.pages.find((candidate) => candidate.id === state.integrationActionDraftPageId);
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!page || !profile) throw new Error('The integration page for this record type was not found.');
    return { page, profile };
  };
  const reopenIntegrationActionPage = async (payload: unknown, foreground: boolean) => {
    const { page, profile } = integrationActionPageContext();
    if (page.id === 'gmail' || page.id === 'google-calendar') {
      await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, payload, foreground, profile.name);
    } else {
      await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, payload, foreground, profile.name);
    }
  };
  const integrationPageContext = (integrationId: string, pageId: string) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!integration || !page || !profile) throw new Error('The integration page or profile was not found.');
    return { integration, page, profile };
  };
  const openPageForStructuredSource = async (page: ReturnType<typeof integrationPageContext>['page'], profile: ReturnType<typeof integrationPageContext>['profile'], payload: unknown) => {
    if (page.id === 'gmail' || page.id === 'google-calendar') {
      await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, payload, false, profile.name);
    } else {
      await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, payload, false, profile.name);
    }
  };
  const integrationBrowserUnavailable = (error: unknown) => error instanceof Error
    && (error.message.includes('Open Gmail or Google Calendar first')
      || error.message.includes('Script failed to execute')
      || error.message.includes('destroyed'));
  const startIntegrationActionInspection = async (inspectionKind: 'parent' | 'target', options: unknown) => {
    const command = inspectionKind === 'parent' ? 'inspect-parent' : 'inspect-target';
    const reopen = () => reopenIntegrationActionPage({ kind: 'command-target', inspectionKind, options }, true);
    if (!await isIntegrationBrowserOpen(state.selectedIntegrationProfileId)) {
      await reopen();
      return;
    }
    try {
      await controlIntegrationBrowser(command, state.selectedIntegrationProfileId, options);
    } catch (error) {
      if (!integrationBrowserUnavailable(error)) throw error;
      await reopen();
    }
  };
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
    if (!integration || !state.integrationActionDraftPageId) throw new Error('Record type integration was not found.');
    const name = state.integrationActionDraftName.trim();
    if (!name) throw new Error('Give the record type a name.');
    const fields = state.integrationActionExamples.map((snapshot, index) => ({
      id: state.integrationActionTargetIds[index] || `field-${crypto.randomUUID()}`,
      label: state.integrationActionTargetLabels[index].trim(),
      cardinality: state.integrationActionTargetCardinalities[index] ?? 'single',
      optional: state.integrationActionTargetOptional[index] ?? true,
      snapshot: matcherSnapshot(snapshot),
      snapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).filter(Boolean).map(matcherSnapshot),
      negativeSnapshots: (state.integrationActionTargetNegativeVariants[index] ?? []).filter(Boolean).map(matcherSnapshot),
      exampleSnapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).map((variant) => variant ? matcherSnapshot(variant) : null),
      absentExampleIndexes: (state.integrationActionTargetAbsentExamples[index] ?? []).flatMap((absent, exampleIndex) => absent ? [exampleIndex] : []),
    }));
    const existingIndex = integration.actions.findIndex((action) => action.id === state.integrationActionDraftActionId);
    const existing = existingIndex >= 0 ? integration.actions[existingIndex] : null;
    const recordType: IntegrationActionDefinition = {
      ...existing,
      id: existing?.id ?? `action-${crypto.randomUUID()}`,
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
    };
    if (existingIndex >= 0) integration.actions[existingIndex] = recordType;
    else integration.actions.push(recordType);
    saveIntegrationRegistry(state.integrationRegistry);
    state.integrationActionBuilderOpen = false;
    state.status = `Saved ${name}`;
    rerender({ preserveMountedDocument: true });
  };
  return {
  discoverIntegrationSources: (integrationId, pageId) => {
    const { page, profile } = integrationPageContext(integrationId, pageId);
    state.integrationStructuredSourcePending = true;
    state.integrationStructuredSourceError = null;
    state.integrationStructuredSourcePageId = pageId;
    rerender({ preserveMountedDocument: true });
    void runBusy(`Looking for structured data sources on ${page.name}...`, async () => {
      const context = { integrationId, pageId };
      if (await isIntegrationBrowserOpen(profile.id)) await controlIntegrationBrowser('discover-sources', profile.id, context);
      else await openPageForStructuredSource(page, profile, { kind: 'source-discovery', context });
    }, { preserveMountedDocument: true }).catch((error) => {
      state.integrationStructuredSourcePending = false;
      state.integrationStructuredSourceError = error instanceof Error ? error.message : String(error);
      rerender({ preserveMountedDocument: true });
    });
  },
  saveIntegrationSource: (integrationId, pageId, source) => {
    const { integration, page } = integrationPageContext(integrationId, pageId);
    const saved: IntegrationRetrievalSourceDefinition = {
      id: `source-${crypto.randomUUID()}`,
      name: source.title,
      kind: source.kind,
      url: source.url,
      method: 'GET',
    };
    page.retrievalSources = [...(page.retrievalSources ?? []), saved];
    state.integrationRegistry = { ...state.integrationRegistry, integrations: state.integrationRegistry.integrations.map((candidate) => candidate.id === integration.id ? { ...integration } : candidate) };
    saveIntegrationRegistry(state.integrationRegistry);
    state.status = `Saved ${saved.name}`;
    rerender({ preserveMountedDocument: true });
  },
  fetchIntegrationSource: (integrationId, pageId, sourceId) => {
    const { page, profile } = integrationPageContext(integrationId, pageId);
    const source = page.retrievalSources?.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error('The structured data source was not found.');
    state.integrationStructuredSourcePending = true;
    state.integrationStructuredSourceError = null;
    rerender({ preserveMountedDocument: true });
    void runBusy(`Fetching ${source.name}...`, async () => {
      const request = { kind: source.kind, url: source.url };
      const context = { integrationId, pageId, sourceId, sourceName: source.name };
      if (await isIntegrationBrowserOpen(profile.id)) await controlIntegrationBrowser('fetch-source', profile.id, { source: request, context });
      else await openPageForStructuredSource(page, profile, { kind: 'source-fetch', source: request, context });
    }, { preserveMountedDocument: true }).catch((error) => {
      state.integrationStructuredSourcePending = false;
      state.integrationStructuredSourceError = error instanceof Error ? error.message : String(error);
      rerender({ preserveMountedDocument: true });
    });
  },
  closeIntegrationStructuredResult: () => {
    state.integrationStructuredResultOpen = false;
    state.integrationStructuredResult = null;
    rerender({ preserveMountedDocument: true });
  },
  openIntegrations: () => {
    if (!state.integrationRegistry.integrations.some((integration) => integration.id === state.selectedIntegrationId)) {
      state.selectedIntegrationId = state.integrationRegistry.integrations[0]?.id ?? '';
    }
    if (!state.integrationRegistry.profiles.some((profile) => profile.id === state.selectedIntegrationProfileId)) {
      state.selectedIntegrationProfileId = state.integrationRegistry.profiles[0]?.id ?? '';
    }
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
    state.integrationRegistry = {
      ...state.integrationRegistry,
      integrations: [...state.integrationRegistry.integrations, integration],
    };
    state.selectedIntegrationId = integration.id;
    saveIntegrationRegistry(state.integrationRegistry);
    state.addIntegrationPageDialogOpen = false;
    state.status = `Added ${integration.name}`;
    rerender({ preserveMountedDocument: true });
  },
  selectIntegration: (integrationId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    if (!integration) throw new Error('Integration was not found.');
    state.selectedIntegrationId = integration.id;
    if (!state.integrationRegistry.profiles.some((profile) => profile.id === state.selectedIntegrationProfileId)) {
      state.selectedIntegrationProfileId = state.integrationRegistry.profiles[0]?.id ?? '';
    }
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
    const profile = createIntegrationProfile('browser', name);
    state.integrationRegistry = { ...state.integrationRegistry, profiles: [...state.integrationRegistry.profiles, profile] };
    saveIntegrationRegistry(state.integrationRegistry);
    state.selectedIntegrationProfileId = profile.id;
    state.addIntegrationProfileDialogOpen = false;
    state.status = `Added ${profile.name}`;
    rerender({ preserveMountedDocument: true });
  },
  openIntegrationPage: (integrationId, pageId, profileId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error('Integration page was not found.');
    const selectedProfileId = profileId ?? state.selectedIntegrationProfileId;
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === selectedProfileId);
    if (!profile) throw new Error('Choose an integration profile.');
    state.selectedIntegrationProfileId = profile.id;
    if (page.id === 'gmail' || page.id === 'google-calendar') {
      const destination = page.id === 'gmail' ? 'gmail' : 'calendar';
      void runBusy(`Opening ${page.name}...`, async () => {
        await openIntegrationBrowser(destination, profile.id, profile.browserStoreId, false, undefined, true, profile.name);
        state.integrationVaultStatus = await loadIntegrationVaultStatus();
        state.status = `Opened ${page.name}`;
      }, { preserveMountedDocument: true });
      return;
    }
    void runBusy(`Opening ${page.name}...`, async () => {
      await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, undefined, true, profile.name);
      state.integrationVaultStatus = await loadIntegrationVaultStatus();
      state.status = `Opened ${page.name}`;
    }, { preserveMountedDocument: true });
  },
  addActionForIntegrationPage: (integrationId, pageId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error('Integration page was not found.');
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!profile) throw new Error('Choose an integration profile.');
    state.integrationActionDraftIntegrationId = integrationId;
    state.integrationActionDraftPageId = pageId;
    state.integrationActionDraftActionId = null;
    state.integrationActionExamples = [];
    state.integrationActionExampleRules = [];
    state.integrationActionTargetLabels = [];
    state.integrationActionTargetIds = [];
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
    state.integrationActionLiveExampleRecords = [];
    state.integrationActionPreviewDiagnostics = null;
    state.integrationActionPreviewPending = false;
    state.integrationActionEditPageLoading = false;
    state.integrationActionBuilderOpen = true;
    state.integrationActionBuilderInitialJson = integrationActionDraftJson();
    state.integrationInspectionResult = null;
    void runBusy(`Opening ${page.name} for action selection...`, async () => {
      if (page.id === 'gmail' || page.id === 'google-calendar') {
        await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, true, undefined, true, profile.name);
      } else {
        await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, true, undefined, true, profile.name);
      }
      state.status = `Select the ${page.name} content this action should use`;
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', profile.id));
  },
  editIntegrationAction: (integrationId, actionId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const action = integration?.actions.find((candidate) => candidate.id === actionId);
    const page = integration?.pages.find((candidate) => candidate.id === action?.pageIds[0]);
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!integration || !action?.pattern || !page || !profile) throw new Error('The record type was not found.');
    const parents = [...action.pattern.parents];
    const fields = action.pattern.fields;
    const variants = fields.map((field) => {
      if (field.exampleSnapshots?.length) return field.exampleSnapshots.map((snapshot) => snapshot ?? null);
      const learned = field.snapshots?.length ? field.snapshots : [field.snapshot];
      return parents.map((_parent, index) => learned[index] ?? learned[0] ?? field.snapshot);
    });
    const absentExamples = fields.map((field) => parents.map((_parent, index) => field.absentExampleIndexes?.includes(index) ?? false));
    state.integrationActionDraftIntegrationId = integrationId;
    state.integrationActionDraftPageId = page.id;
    state.integrationActionDraftActionId = action.id;
    state.integrationActionExamples = fields.map((field) => field.snapshot);
    state.integrationActionExampleRules = fields.map(() => []);
    state.integrationActionTargetLabels = fields.map((field) => field.label);
    state.integrationActionTargetIds = fields.map((field) => field.id);
    state.integrationActionTargetCardinalities = fields.map((field) => field.cardinality);
    state.integrationActionTargetOptional = fields.map((field) => field.optional ?? true);
    state.integrationActionTargetParentIndexes = variants.map((fieldVariants) => Math.max(0, fieldVariants.findIndex(Boolean)));
    state.integrationActionTargetSelectionParentIndex = 0;
    state.integrationActionTargetSelectionFieldIndex = null;
    state.integrationActionTargetVariants = variants;
    state.integrationActionTargetNegativeVariants = fields.map((field, fieldIndex) => parents.map((_parent, parentIndex) => absentExamples[fieldIndex][parentIndex] ? field.negativeSnapshots?.[0] ?? null : null));
    state.integrationActionTargetAbsentExamples = absentExamples;
    state.integrationActionSelectedParentIndex = 0;
    state.integrationActionMinimumConfidence = action.pattern.minimumConfidence ?? 0.8;
    state.integrationActionAnchors = parents;
    state.integrationActionAnchorRules = parents.map(() => []);
    state.integrationActionSelectionKind = 'example';
    state.integrationActionSelectionPending = false;
    state.integrationActionBuilderStep = 'define';
    state.integrationActionDraftName = action.name;
    state.integrationActionDraftDescription = action.description;
    state.integrationActionPreviewRecords = [];
    state.integrationActionLiveExampleRecords = [];
    state.integrationActionPreviewDiagnostics = null;
    state.integrationActionPreviewPending = false;
    state.integrationActionEditPageLoading = true;
    state.integrationActionBuilderOpen = true;
    state.integrationActionBuilderInitialJson = integrationActionDraftJson();
    state.integrationInspectionResult = parents[0] ?? null;
    state.inspectionPrivacyRules = [];
    state.status = `Editing ${action.name}`;
    rerender({ preserveMountedDocument: true });
    void (async () => {
      try {
        const liveExampleExtraction = {
          pattern: actionPatternPayload(action),
          context: { mode: 'examples' },
          foreground: false,
        };
        if (page.id === 'gmail' || page.id === 'google-calendar') {
          await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, liveExampleExtraction, false, profile.name);
        } else {
          await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, liveExampleExtraction, false, profile.name);
        }
        state.integrationActionEditPageLoading = false;
        state.status = `Ready to edit ${action.name}`;
        rerender({ preserveMountedDocument: true });
      } catch (error) {
        state.integrationActionEditPageLoading = false;
        state.error = error instanceof Error ? error.message : String(error);
        rerender({ preserveMountedDocument: true });
      }
    })();
  },
  closeIntegrationActionBuilder: () => {
    if (state.integrationActionSelectionPending) {
      void controlIntegrationBrowser('cancel-inspect', state.selectedIntegrationProfileId);
    }
    if (integrationActionDraftJson() !== state.integrationActionBuilderInitialJson) {
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
      const options = { parentCssPath, parentSnapshot, multiSelect: fieldIndex === null };
      await startIntegrationActionInspection('target', options);
      state.status = fieldIndex === null ? 'Select fields inside the parent, then choose Done' : 'Select replacement data inside the parent';
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
      const options = { existingPattern };
      await startIntegrationActionInspection('parent', options);
      state.status = 'Select another parent containing the same kind of data';
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', state.selectedIntegrationProfileId));
  },
  removeIntegrationActionSelection: (kind, index) => {
    if (kind === 'example') {
      state.integrationActionAnchors.splice(index, 1);
      state.integrationActionAnchorRules.splice(index, 1);
      state.integrationActionLiveExampleRecords.splice(index, 1);
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
        state.integrationActionTargetIds.splice(fieldIndex, 1);
        state.integrationActionTargetCardinalities.splice(fieldIndex, 1);
        state.integrationActionTargetOptional.splice(fieldIndex, 1);
        state.integrationActionTargetParentIndexes.splice(fieldIndex, 1);
      }
      state.integrationActionSelectedParentIndex = Math.max(0, Math.min(state.integrationActionSelectedParentIndex, state.integrationActionAnchors.length - 1));
    } else {
      state.integrationActionExamples.splice(index, 1);
      state.integrationActionExampleRules.splice(index, 1);
      state.integrationActionTargetLabels.splice(index, 1);
      state.integrationActionTargetIds.splice(index, 1);
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
    state.integrationActionSelectionKind = useParent ? 'example' : state.integrationActionExamples.length ? 'target' : 'parent';
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
  updateIntegrationActionDraftName: (name) => {
    state.integrationActionDraftName = name;
  },
  updateIntegrationActionDraftDescription: (description) => {
    state.integrationActionDraftDescription = description;
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
    state.integrationActionMinimumConfidence = Math.max(0.5, Math.min(0.95, value));
  },
  testIntegrationActionPattern: () => {
    const targets = state.integrationActionExamples.map((snapshot, index) => ({ label: state.integrationActionTargetLabels[index] || `Target ${index + 1}`, cardinality: state.integrationActionTargetCardinalities[index] ?? 'single', optional: state.integrationActionTargetOptional[index] ?? true, snapshot, snapshots: (state.integrationActionTargetVariants[index] ?? [snapshot]).filter(Boolean), negativeSnapshots: (state.integrationActionTargetNegativeVariants[index] ?? []).filter(Boolean) }));
    const pattern = { minimumConfidence: state.integrationActionMinimumConfidence, parents: state.integrationActionAnchors, targets };
    void (async () => {
      if (!await isIntegrationBrowserOpen(state.selectedIntegrationProfileId)) {
        await reopenIntegrationActionPage({ kind: 'pattern-highlight', pattern }, true);
        state.status = 'Highlighted structural pattern matches';
        return;
      }
      try {
        await controlIntegrationBrowser('test-pattern', state.selectedIntegrationProfileId, pattern);
      } catch (error) {
        if (!integrationBrowserUnavailable(error)) throw error;
        await reopenIntegrationActionPage({ kind: 'pattern-highlight', pattern }, true);
      }
      state.status = 'Highlighted structural pattern matches';
    })().catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = 'Highlight matches failed';
      rerender({ preserveMountedDocument: true });
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
    state.integrationActionPreviewPending = true;
    state.integrationActionBuilderOpen = true;
    state.status = 'Reviewing extraction in the background...';
    rerender({ preserveMountedDocument: true });
    const extraction = {
      pattern: { minimumConfidence: state.integrationActionMinimumConfidence, parents: state.integrationActionAnchors, targets },
      context: { mode: 'builder' },
      foreground: false,
    };
    void (async () => {
      if (!await isIntegrationBrowserOpen(state.selectedIntegrationProfileId)) {
        await reopenIntegrationActionPage(extraction, false);
        return;
      }
      try {
        await controlIntegrationBrowser('extract-pattern', state.selectedIntegrationProfileId, extraction);
      } catch (error) {
        if (!integrationBrowserUnavailable(error)) throw error;
        await reopenIntegrationActionPage(extraction, false);
      }
    })().catch((error) => {
        state.integrationActionPreviewPending = false;
        state.error = error instanceof Error ? error.message : String(error);
        state.status = 'Review extraction failed';
        rerender({ preserveMountedDocument: true });
      });
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
    state.integrationActionFetchPendingId = action.id;
    state.integrationActionFetchError = null;
    state.error = null;
    state.status = `Fetching ${action.name} in the background...`;
    rerender({ preserveMountedDocument: true });
    void (async () => {
      const extraction = { pattern, context: { mode: 'saved-action', actionId: action.id, actionName: action.name, expectedOrigin: new URL(page.url).origin } };
      try {
        if (page.id === 'gmail' || page.id === 'google-calendar') {
          await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, extraction, false, profile.name);
        } else {
          await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, extraction, false, profile.name);
        }
      } catch (error) {
        state.integrationActionFetchPendingId = null;
        state.integrationActionFetchError = error instanceof Error ? error.message : String(error);
        state.error = state.integrationActionFetchError;
        state.status = 'Fetch failed';
        rerender({ preserveMountedDocument: true });
      }
    })();
  },
  closeIntegrationActionResult: () => {
    state.integrationActionResultOpen = false;
    state.integrationActionResultRecords = [];
    state.integrationActionResultActionId = null;
    rerender({ preserveMountedDocument: true });
  },
  addCommandForIntegrationAction: (integrationId, actionId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const action = integration?.actions.find((candidate) => candidate.id === actionId);
    if (!integration || !action?.pattern) throw new Error('Define the record before adding a command.');
    state.integrationCommandBuilderOpen = true;
    state.integrationCommandSelectionPending = false;
    state.integrationCommandDraftIntegrationId = integrationId;
    state.integrationCommandDraftActionId = actionId;
    state.integrationCommandDraftPageId = action.pageIds[0] ?? null;
    state.integrationCommandDraftName = '';
    state.integrationCommandDraftScope = 'record';
    state.integrationCommandDraftGesture = 'click';
    state.integrationCommandDraftTarget = null;
    state.integrationCommandDraftRecord = null;
    state.integrationCommandSelectionStage = 'record';
    rerender({ preserveMountedDocument: true });
  },
  addCommandForIntegrationPage: (integrationId, pageId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    if (!integration || !page) throw new Error('The page was not found.');
    state.integrationCommandBuilderOpen = true;
    state.integrationCommandSelectionPending = false;
    state.integrationCommandDraftIntegrationId = integrationId;
    state.integrationCommandDraftActionId = null;
    state.integrationCommandDraftPageId = pageId;
    state.integrationCommandDraftName = '';
    state.integrationCommandDraftScope = 'page';
    state.integrationCommandDraftGesture = 'click';
    state.integrationCommandDraftTarget = null;
    state.integrationCommandDraftRecord = null;
    state.integrationCommandSelectionStage = 'target';
    rerender({ preserveMountedDocument: true });
  },
  beginIntegrationCommandSelection: (name, gesture) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationCommandDraftIntegrationId);
    const action = integration?.actions.find((candidate) => candidate.id === state.integrationCommandDraftActionId);
    const page = integration?.pages.find((candidate) => candidate.id === state.integrationCommandDraftPageId);
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!integration || !page || !profile || (state.integrationCommandDraftScope === 'record' && !action?.pattern)) throw new Error('The command record or page was not found.');
    if (!name.trim()) throw new Error('Give the command a name.');
    state.integrationCommandDraftName = name.trim();
    state.integrationCommandDraftGesture = gesture;
    state.integrationCommandDraftTarget = null;
    state.integrationCommandDraftRecord = null;
    state.integrationCommandSelectionStage = state.integrationCommandDraftScope === 'record' ? 'record' : 'target';
    state.integrationCommandSelectionPending = true;
    const pendingSelection = {
      kind: 'command-target',
      context: { expectedOrigin: new URL(page.url).origin },
      inspectionKind: state.integrationCommandSelectionStage === 'record' ? 'parent' : 'target',
      options: state.integrationCommandSelectionStage === 'record' ? { existingPattern: actionPatternPayload(action!) } : {},
    };
    void runBusy(`Opening ${page.name} to select the command target...`, async () => {
      if (page.id === 'gmail' || page.id === 'google-calendar') {
        await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, pendingSelection, true, profile.name);
      } else {
        await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, pendingSelection, true, profile.name);
      }
      state.status = `Select the control for ${state.integrationCommandDraftName}`;
    }, { preserveMountedDocument: true });
  },
  cancelIntegrationCommandBuilder: () => {
    if (state.integrationCommandSelectionPending) void controlIntegrationBrowser('cancel-inspect', state.selectedIntegrationProfileId);
    state.integrationCommandBuilderOpen = false;
    state.integrationCommandSelectionPending = false;
    state.integrationCommandDraftTarget = null;
    state.integrationCommandDraftRecord = null;
    rerender({ preserveMountedDocument: true });
  },
  saveIntegrationCommand: () => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationCommandDraftIntegrationId);
    const action = integration?.actions.find((candidate) => candidate.id === state.integrationCommandDraftActionId);
    const page = integration?.pages.find((candidate) => candidate.id === state.integrationCommandDraftPageId);
    if (!integration || !page || !state.integrationCommandDraftTarget || (state.integrationCommandDraftScope === 'record' && !action)) throw new Error('Select a command target before saving.');
    const command = {
      id: `command-${crypto.randomUUID()}`,
      name: state.integrationCommandDraftName,
      scope: state.integrationCommandDraftScope,
      steps: [{ gesture: state.integrationCommandDraftGesture, target: matcherSnapshot(state.integrationCommandDraftTarget) }],
    };
    if (state.integrationCommandDraftScope === 'record') {
      action!.commands ??= [];
      action!.commands!.push(command);
    } else {
      page.commands ??= [];
      page.commands.push(command);
    }
    saveIntegrationRegistry(state.integrationRegistry);
    state.integrationCommandBuilderOpen = false;
    state.integrationCommandDraftTarget = null;
    state.integrationCommandDraftRecord = null;
    state.status = `Saved ${state.integrationCommandDraftName}`;
    rerender({ preserveMountedDocument: true });
  },
  requestDeleteIntegrationCommand: (integrationId, actionId, commandId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const action = integration?.actions.find((candidate) => candidate.id === actionId);
    const command = action?.commands?.find((candidate) => candidate.id === commandId);
    if (!command) throw new Error('The item command was not found.');
    state.integrationCommandDeleteIntegrationId = integrationId;
    state.integrationCommandDeleteActionId = actionId;
    state.integrationCommandDeleteCommandId = commandId;
    state.integrationCommandDeleteDialogOpen = true;
    rerender({ preserveMountedDocument: true });
  },
  cancelDeleteIntegrationCommand: () => {
    state.integrationCommandDeleteDialogOpen = false;
    state.integrationCommandDeleteIntegrationId = null;
    state.integrationCommandDeleteActionId = null;
    state.integrationCommandDeleteCommandId = null;
    rerender({ preserveMountedDocument: true });
  },
  confirmDeleteIntegrationCommand: () => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationCommandDeleteIntegrationId);
    const action = integration?.actions.find((candidate) => candidate.id === state.integrationCommandDeleteActionId);
    const command = action?.commands?.find((candidate) => candidate.id === state.integrationCommandDeleteCommandId);
    if (!action || !command) throw new Error('The item command was not found.');
    action.commands = action.commands?.filter((candidate) => candidate.id !== command.id);
    saveIntegrationRegistry(state.integrationRegistry);
    state.integrationCommandDeleteDialogOpen = false;
    state.integrationCommandDeleteIntegrationId = null;
    state.integrationCommandDeleteActionId = null;
    state.integrationCommandDeleteCommandId = null;
    state.status = `Deleted ${command.name}`;
    rerender({ preserveMountedDocument: true });
  },
  runIntegrationCommand: (integrationId, actionId, commandId, recordParent) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const action = integration?.actions.find((candidate) => candidate.id === actionId);
    const command = action?.commands?.find((candidate) => candidate.id === commandId);
    const payload = action && command ? commandExecutionPayload(action, command, recordParent) : null;
    if (!integration || !action || !command || !payload) throw new Error('The saved command is incomplete.');
    void runBusy(`Running ${command.name}...`, async () => {
      await controlIntegrationBrowser('execute-command', state.selectedIntegrationProfileId, payload);
      state.status = `Ran ${command.name}`;
    }, { preserveMountedDocument: true });
  },
  runIntegrationPageCommand: (integrationId, pageId, commandId) => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === pageId);
    const command = page?.commands?.find((candidate) => candidate.id === commandId);
    const payload = command ? pageCommandExecutionPayload(command) : null;
    const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === state.selectedIntegrationProfileId);
    if (!integration || !page || !command || !payload || !profile) throw new Error('The saved page command is incomplete.');
    void runBusy(`Running ${command.name}...`, async () => {
      const pendingExecution = { kind: 'command-execution', context: { expectedOrigin: new URL(page.url).origin }, payload };
      if (page.id === 'gmail' || page.id === 'google-calendar') await openIntegrationBrowser(page.id === 'gmail' ? 'gmail' : 'calendar', profile.id, profile.browserStoreId, false, pendingExecution, true, profile.name);
      else await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, pendingExecution, true, profile.name);
      state.status = `Ran ${command.name}`;
    }, { preserveMountedDocument: true });
  },
  requestDeleteIntegrationAction: (integrationId, actionId) => {
    state.integrationRecordDeleteDialogOpen = true;
    state.integrationRecordDeleteIntegrationId = integrationId;
    state.integrationRecordDeleteActionId = actionId;
    rerender({ preserveMountedDocument: true });
  },
  cancelDeleteIntegrationAction: () => {
    state.integrationRecordDeleteDialogOpen = false;
    state.integrationRecordDeleteIntegrationId = null;
    state.integrationRecordDeleteActionId = null;
    rerender({ preserveMountedDocument: true });
  },
  confirmDeleteIntegrationAction: () => {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationRecordDeleteIntegrationId);
    const action = integration?.actions.find((candidate) => candidate.id === state.integrationRecordDeleteActionId);
    if (!integration || !action) throw new Error('The record was not found.');
    integration.actions = integration.actions.filter((candidate) => candidate.id !== action.id);
    saveIntegrationRegistry(state.integrationRegistry);
    state.integrationRecordDeleteDialogOpen = false;
    state.integrationRecordDeleteIntegrationId = null;
    state.integrationRecordDeleteActionId = null;
    state.status = `Deleted ${action.name}`;
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
