import { chooseWorkspaceFolder, type DocumentCreationType, type DocumentFile, type McpSettings } from './backend';
import { getMatchedPaletteId, getMatchedSavedThemeId, getPaletteById, saveColorThemeSettings } from './colorTheme';
import { state } from './state';
import type { HvyMode, VisualDocument } from './hvy';
import { applyAppColorTheme, loadWorkspace, mountRoot, rerender } from './main';

const DEFAULT_AI_MAX_CONTEXT_CHARS = 40_000;
const AI_MIN_CONTEXT_CHARS = 1_000;
const AI_MAX_CONTEXT_CHARS = 750_000;
const AI_CONTEXT_STEP_CHARS = 1_000;

export function defaultHvyDocument(title = 'Untitled'): string {
  return `---
hvy_version: 0.1
title: ${JSON.stringify(title)}
---
`;
}

export function documentFileName(name: string, documentType: DocumentCreationType = 'hvy'): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const targetExtension = documentType === 'phvy' ? '.phvy' : documentType === 'thvy' ? '.thvy' : '.hvy';
  if (hasDocumentExtension(trimmed)) {
    return trimmed.replace(/\.(hvy|thvy|phvy)$/i, targetExtension);
  }
  return `${trimmed}${targetExtension}`;
}

export function workspaceRootDocumentFileName(name: string, documentType: DocumentCreationType = 'hvy'): string | null {
  const trimmed = name.trim();
  if (hasInvalidDocumentNameSyntax(trimmed)) return null;
  return documentFileName(trimmed, documentType);
}

export function hasInvalidDocumentNameSyntax(name: string): boolean {
  const trimmed = name.trim();
  return /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) || trimmed.startsWith('.');
}

export function documentTypeForExtension(extension: DocumentFile['extension']): DocumentCreationType {
  if (extension === '.phvy') return 'phvy';
  if (extension === '.thvy') return 'thvy';
  return 'hvy';
}

export function documentTitle(fileName: string): string {
  return fileName.replace(/\.(t?hvy|phvy|md)$/i, '');
}

export function syncRenamedTemplateMetadata(document: VisualDocument, oldName: string, newName: string): boolean {
  const meta = document.meta as Record<string, unknown>;
  let changed = false;
  if (meta.title === oldName) {
    meta.title = newName;
    changed = true;
  }
  changed = renameTemplateDefinitionEntries(meta.component_defs, oldName, newName) || changed;
  changed = renameTemplateDefinitionEntries(meta.section_defs, oldName, newName) || changed;
  return changed;
}

export function renameTemplateDefinitionEntries(value: unknown, oldName: string, newName: string): boolean {
  if (!Array.isArray(value)) return false;
  let changed = false;
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const definition = entry as Record<string, unknown>;
    if (definition.name === oldName) {
      definition.name = newName;
      changed = true;
    }
    if (definition.key === oldName) {
      definition.key = newName;
      changed = true;
    }
  });
  return changed;
}

export function hasDocumentExtension(fileName: string): boolean {
  return /\.(t?hvy|phvy)$/i.test(fileName);
}

export function templateFileName(name: string, extension: '.thvy' | '.phvy' = '.thvy'): string {
  const trimmed = name.trim();
  const base = trimmed.replace(/\.(t?hvy|phvy|hvy|md)$/i, '').trim() || 'Untitled';
  return `${base}${extension}`;
}

export function pdfFileName(name: string): string {
  const base = name.trim().replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '').trim() || 'document';
  return `${base}.pdf`;
}

export function revealStatusLabel(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'Shown in Finder';
  if (platform.includes('win')) return 'Opened in Explorer';
  return 'Opened containing folder';
}

export function applyTemplateTitle(template: string, title: string): string {
  return template.replace(/^title:.*$/m, `title: ${JSON.stringify(title)}`);
}

export function documentStorageKey(identifier: string): string {
  return `hvy-galaxy:document:${identifier}`;
}

export function normalizeDocumentMode(
  mode: HvyMode,
  options: { readOnly: boolean; hiddenFromAI: boolean; extension: DocumentFile['extension'] },
): HvyMode {
  if (options.readOnly && mode !== 'viewer') return 'viewer';
  if (options.hiddenFromAI && mode === 'ai') return 'viewer';
  if (options.extension === '.md' && mode !== 'viewer') return 'viewer';
  return mode;
}


export function closeUiBeforeAiSettings(): void {
  state.newWorkspaceDialogOpen = false;
  state.workspaceInitializationDialogOpen = false;
  state.workspaceInitializationPath = null;
  state.workspaceInitializationName = null;
  state.newDocumentWorkspacePath = null;
  state.colorThemeDialogOpen = false;
  state.aboutDialogOpen = false;
  state.debugLogDialogOpen = false;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.mcpSettingsDiscardDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  state.aiSettingsDiscardDialogOpen = false;
  state.aiSettingsSelectedProviderId = null;
  closeMountedTransientUi();
}

export function closeUiBeforeAbout(): void {
  state.newWorkspaceDialogOpen = false;
  state.workspaceInitializationDialogOpen = false;
  state.workspaceInitializationPath = null;
  state.workspaceInitializationName = null;
  state.newDocumentWorkspacePath = null;
  state.debugLogDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.aiSettingsDiscardDialogOpen = false;
  state.aiSettingsSelectedProviderId = null;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.mcpSettingsDiscardDialogOpen = false;
  state.colorThemeDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

export function closeUiBeforeColorTheme(): void {
  state.newWorkspaceDialogOpen = false;
  state.workspaceInitializationDialogOpen = false;
  state.workspaceInitializationPath = null;
  state.workspaceInitializationName = null;
  state.newDocumentWorkspacePath = null;
  state.aboutDialogOpen = false;
  state.debugLogDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.aiSettingsDiscardDialogOpen = false;
  state.aiSettingsSelectedProviderId = null;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.mcpSettingsDiscardDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

export function closeUiBeforeMcpSettings(): void {
  state.newWorkspaceDialogOpen = false;
  state.workspaceInitializationDialogOpen = false;
  state.workspaceInitializationPath = null;
  state.workspaceInitializationName = null;
  state.newDocumentWorkspacePath = null;
  state.aboutDialogOpen = false;
  state.debugLogDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.aiSettingsDiscardDialogOpen = false;
  state.aiSettingsSelectedProviderId = null;
  state.colorThemeDialogOpen = false;
  state.mcpSettingsDiscardDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

export function closeUiBeforeWorkspaceFilter(): void {
  state.newWorkspaceDialogOpen = false;
  state.workspaceInitializationDialogOpen = false;
  state.workspaceInitializationPath = null;
  state.workspaceInitializationName = null;
  state.newDocumentWorkspacePath = null;
  state.aboutDialogOpen = false;
  state.debugLogDialogOpen = false;
  state.aiSettingsDialogOpen = false;
  state.aiSettingsDraft = null;
  state.aiSettingsDialogInitialJson = null;
  state.aiSettingsDiscardDialogOpen = false;
  state.aiSettingsSelectedProviderId = null;
  state.mcpSettingsDialogOpen = false;
  state.mcpSettingsDraft = null;
  state.mcpSettingsDialogInitialJson = null;
  state.mcpSettingsDiscardDialogOpen = false;
  state.colorThemeDialogOpen = false;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

export function persistAndApplyColorTheme(): void {
  saveColorThemeSettings(state.colorTheme);
  applyAppColorTheme();
  state.status = 'Updated colors';
}

export function updateThemeRowChrome(name: string, value: string): void {
  const row = document.querySelector<HTMLElement>(`.theme-color-row[data-theme-color-name="${cssEscape(name)}"]`);
  row?.querySelector<HTMLElement>('.theme-color-swatch')?.setAttribute('style', value ? `background: ${value};` : '');
  row?.querySelector<HTMLButtonElement>('[data-action="theme-reset-color"]')?.toggleAttribute('disabled', !value);
  const dialog = row?.closest<HTMLElement>('.color-theme-dialog');
  if (!dialog) return;
  if (value.trim()) {
    dialog.style.setProperty(name, value.trim());
  } else {
    dialog.style.removeProperty(name);
  }
}

export function currentThemeDisplayName(): string | null {
  const customThemeId = getMatchedSavedThemeId(state.colorTheme.colors, state.colorTheme.savedThemes);
  if (customThemeId) {
    return state.colorTheme.savedThemes.find((theme) => theme.id === customThemeId)?.name ?? null;
  }
  const paletteId = getMatchedPaletteId(state.colorTheme.colors);
  if (paletteId) {
    return getPaletteById(paletteId)?.name ?? null;
  }
  return Object.keys(state.colorTheme.colors).length === 0 ? 'Default' : null;
}

export function themeSuggestedFileName(name: string): string {
  const stem = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || 'Untitled Theme';
  return stem.toLowerCase().endsWith('.hvytheme') ? stem : `${stem}.hvytheme`;
}

export function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replaceAll('"', '\\"');
}

export function closeMountedTransientUi(): void {
  const root = mountRoot;
  if (!root) return;
  root
    .querySelector<HTMLElement>('[data-action="close-search"], [data-action="close-ai-edit"], [data-modal-action="close"]')
    ?.click();
  if (root.querySelector('.workspace-filter-dialog, .workspace-filter-backdrop, .modal-root, .ai-edit-popover, .hvy-email-link-popover')) {
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
}

export function cloneAiSettings(settings: typeof state.aiSettings): typeof state.aiSettings {
  return JSON.parse(JSON.stringify(settings)) as typeof state.aiSettings;
}

export function cloneMcpSettings(settings: McpSettings): McpSettings {
  return JSON.parse(JSON.stringify(settings)) as McpSettings;
}

export function aiSettingsChanged(settings: typeof state.aiSettings | undefined): boolean {
  const initial = state.aiSettingsDialogInitialJson;
  if (!initial) return false;
  const current = JSON.stringify(canonicalAiSettings(settings ?? state.aiSettingsDraft ?? state.aiSettings));
  return current !== initial;
}

export function mcpSettingsChanged(settings: McpSettings | undefined): boolean {
  const initial = state.mcpSettingsDialogInitialJson;
  if (!initial) return false;
  const current = JSON.stringify(settings ?? state.mcpSettingsDraft ?? state.mcpSettings);
  return current !== initial;
}

export async function copyMcpConnectionUrl(url: string): Promise<void> {
  await navigator.clipboard.writeText(url);
  state.status = 'Copied MCP server URL';
  rerender({ preserveMountedDocument: true });
}

export async function copyMcpBearerToken(token: string): Promise<void> {
  await navigator.clipboard.writeText(token);
  state.status = 'Copied MCP bearer token';
  rerender({ preserveMountedDocument: true });
}

export async function copyMcpSetupValue(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  state.status = `Copied ${label}`;
  rerender({ preserveMountedDocument: true });
}

export function canonicalAiSettings(settings: typeof state.aiSettings): typeof state.aiSettings {
  return {
    activeProviderId: settings.activeProviderId,
    providers: [...settings.providers].sort((left, right) => left.provider.localeCompare(right.provider)),
    maxContextChars: normalizeAiMaxContextChars(settings.maxContextChars),
    actions: {
      chat: settings.actions.chat,
      edit: settings.actions.edit,
      importPlanning: settings.actions.importPlanning,
      importWriting: settings.actions.importWriting,
      importCleanup: settings.actions.importCleanup,
      semanticFilter: settings.actions.semanticFilter,
      compaction: settings.actions.compaction,
    },
  };
}

export function normalizeAiMaxContextChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_MAX_CONTEXT_CHARS;
  const stepped = Math.round(parsed / AI_CONTEXT_STEP_CHARS) * AI_CONTEXT_STEP_CHARS;
  return Math.min(AI_MAX_CONTEXT_CHARS, Math.max(AI_MIN_CONTEXT_CHARS, stepped));
}

export function requestWorkspaceInitialization(path: string, defaultName: string): null {
  state.workspaceInitializationDialogOpen = true;
  state.workspaceInitializationPath = path;
  state.workspaceInitializationName = defaultName;
  state.status = 'Ready';
  return null;
}

export async function createWorkspaceInChosenFolder() {
  const candidate = await chooseWorkspaceFolder();
  if (!candidate) return null;
  if (candidate.hasManifest) {
    return loadWorkspace(candidate.path);
  }
  return requestWorkspaceInitialization(candidate.path, candidate.defaultName);
}
