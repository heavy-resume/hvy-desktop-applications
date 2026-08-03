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
import { applyInspectionPrivacyRules, createCustomPageIntegration, createIntegrationProfile, matchingInspectionPrivacyRules, saveIntegrationRegistry } from './integrationRegistry';

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
  setDocumentDirty(true);
  state.status = 'Updated document colors';
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
    state.integrationActionAnchors = [];
    state.integrationActionAnchorRules = [];
    state.integrationActionSelectionKind = 'example';
    state.integrationActionSelectionPending = true;
    state.integrationActionBuilderStep = 'review';
    state.integrationActionDraftName = '';
    state.integrationActionDraftDescription = '';
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
  addAnotherIntegrationActionExample: () => {
    state.integrationActionBuilderOpen = true;
    state.integrationActionBuilderStep = 'review';
    state.integrationActionSelectionKind = 'example';
    state.integrationActionSelectionPending = true;
    void runBusy('Starting another selection...', async () => {
      await controlIntegrationBrowser('inspect', state.selectedIntegrationProfileId);
      state.status = 'Select another field or example in the open page';
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', state.selectedIntegrationProfileId));
  },
  addIntegrationActionAnchor: () => {
    state.integrationActionBuilderOpen = true;
    state.integrationActionBuilderStep = 'review';
    state.integrationActionSelectionKind = 'anchor';
    state.integrationActionSelectionPending = true;
    void runBusy('Starting anchor selection...', async () => {
      await controlIntegrationBrowser('inspect-anchor', state.selectedIntegrationProfileId);
      state.status = 'Select a stable label, container, or other anchor in the open page';
    }, { preserveMountedDocument: true }).then(() => controlIntegrationBrowser('focus-browser', state.selectedIntegrationProfileId));
  },
  removeIntegrationActionSelection: (kind, index) => {
    if (kind === 'anchor') {
      state.integrationActionAnchors.splice(index, 1);
      state.integrationActionAnchorRules.splice(index, 1);
    } else {
      state.integrationActionExamples.splice(index, 1);
      state.integrationActionExampleRules.splice(index, 1);
    }
    const useAnchor = state.integrationActionAnchors.length > 0;
    const nextItems = useAnchor ? state.integrationActionAnchors : state.integrationActionExamples;
    const nextRules = useAnchor ? state.integrationActionAnchorRules : state.integrationActionExampleRules;
    state.integrationActionSelectionKind = useAnchor ? 'anchor' : 'example';
    state.integrationInspectionResult = nextItems.at(-1) ?? null;
    state.inspectionPrivacyRules = nextRules.at(-1) ? [...nextRules.at(-1)!] : [];
    rerender({ preserveMountedDocument: true });
  },
  reviewIntegrationActionSelection: (kind, index) => {
    const items = kind === 'anchor' ? state.integrationActionAnchors : state.integrationActionExamples;
    const rules = kind === 'anchor' ? state.integrationActionAnchorRules : state.integrationActionExampleRules;
    state.integrationActionSelectionKind = kind;
    state.integrationInspectionResult = items[index] ?? null;
    state.inspectionPrivacyRules = [...(rules[index] ?? [])];
    state.integrationActionBuilderStep = 'review';
    rerender({ preserveMountedDocument: true });
  },
  continueIntegrationActionBuilder: () => {
    state.integrationActionBuilderStep = 'instructions';
    rerender({ preserveMountedDocument: true });
  },
  backIntegrationActionBuilder: () => {
    state.integrationActionBuilderStep = state.integrationActionBuilderStep === 'confirm' ? 'instructions' : 'review';
    rerender({ preserveMountedDocument: true });
  },
  reviewIntegrationActionRequest: (name, description) => {
    state.integrationActionDraftName = name.trim();
    state.integrationActionDraftDescription = description.trim();
    state.integrationActionBuilderStep = 'confirm';
    rerender({ preserveMountedDocument: true });
  },
  saveIntegrationActionDraft: () => {
    const name = state.integrationActionDraftName;
    const description = state.integrationActionDraftDescription;
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationActionDraftIntegrationId);
    if (!integration || !state.integrationActionDraftPageId) throw new Error('Action integration was not found.');
    integration.actions.push({
      id: `action-${crypto.randomUUID()}`,
      integrationId: integration.id,
      name: name.trim(),
      description: description.trim(),
      pageIds: [state.integrationActionDraftPageId],
      script: '',
      resultSchema: {},
      permissions: ['dom:read'],
      version: 1,
      status: 'draft',
      examples: state.integrationActionExamples.map((example, index) => applyInspectionPrivacyRules(example, state.integrationActionExampleRules[index] ?? [])),
      anchors: state.integrationActionAnchors.map((anchor, index) => applyInspectionPrivacyRules(anchor, state.integrationActionAnchorRules[index] ?? [])),
    });
    saveIntegrationRegistry(state.integrationRegistry);
    state.integrationActionBuilderOpen = false;
    state.status = `Saved ${name.trim()} as an action draft`;
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
    if (state.integrationActionSelectionKind === 'anchor') state.integrationActionAnchorRules[state.integrationActionAnchorRules.length - 1] = [...state.inspectionPrivacyRules];
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
    if (state.integrationActionSelectionKind === 'anchor') state.integrationActionAnchorRules[state.integrationActionAnchorRules.length - 1] = [...state.inspectionPrivacyRules];
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
