import { installAiChatClient } from './aiClient';
import { installMcpClient, openColorThemeDialog, openExternalUrl, removeMcpClient, restoreMcpClientBackup, saveAiSettings, saveColorThemeAsDialog, saveMcpSettings, startMcpServer, stopMcpServer, type McpClientInstallTarget } from './backend';
import { createColorThemeFile, createSavedThemeId, getMatchedSavedThemeId, getPaletteById, isCssVariableName, parseColorThemeFile, serializeColorThemeFile, saveColorThemeSettings } from './colorTheme';
import { clearDebugLogEntries, getDebugLogEntries } from './debugLog';
import { state } from './state';
import { refreshMcpClientInstallStatus, mountCurrentDocument, rerender, refreshDebugLogModal, runBusy, closeUiBeforeAiSettings, closeUiBeforeAbout, closeUiBeforeColorTheme, closeUiBeforeMcpSettings, persistAndApplyColorTheme, updateThemeRowChrome, currentThemeDisplayName, themeSuggestedFileName, cloneAiSettings, cloneMcpSettings, aiSettingsChanged, mcpSettingsChanged, copyMcpConnectionUrl, copyMcpBearerToken, copyMcpSetupValue, canonicalAiSettings } from './main';
import type { UiHandlers } from './ui';

export function createSettingsHandlers(): Partial<UiHandlers> {
  return {
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
  saveAiSettings: (settings) => void runBusy('Saving AI settings...', async () => {
    state.aiSettings = await saveAiSettings(settings);
    installAiChatClient(state.aiSettings);
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.aiSettingsDiscardDialogOpen = false;
    state.aiSettingsSelectedProviderId = null;
    state.status = 'Saved AI settings';
  }),
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
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  closeColorTheme: () => {
    state.colorThemeDialogOpen = false;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  updateColorThemeName: (name) => {
    state.colorTheme = { ...state.colorTheme, themeName: name };
    saveColorThemeSettings(state.colorTheme);
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
    };
    persistAndApplyColorTheme();
    state.colorThemeDialogOpen = true;
    state.status = `Imported theme ${theme.name}`;
  }),
  selectColorTheme: (id) => {
    const now = Date.now();
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
    const next = { ...state.colorTheme.colors };
    delete next[name];
    state.colorTheme = { ...state.colorTheme, colors: next };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  applyColorThemePalette: (id) => {
    const palette = id ? getPaletteById(id) : null;
    const themeUseId = id ? `palette:${id}` : 'default';
    state.colorTheme = {
      colors: palette ? { ...palette.colors } : {},
      themeName: palette?.name ?? '',
      savedThemes: state.colorTheme.savedThemes,
      themeUses: { ...state.colorTheme.themeUses, [themeUseId]: Date.now() },
    };
    persistAndApplyColorTheme();
    rerender({ preserveMountedDocument: true });
  },
  };
}
