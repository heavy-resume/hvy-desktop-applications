import { defaultAiSettings, defaultAppSettings, defaultMcpClientInstallStatus, defaultMcpServerStatus, defaultMcpSettings, defaultMcpStdioLaunchConfig, type AiSettings, type AppSettings, type ArchivedWorkspace, type DocumentBackup, type DocumentCreationType, type DocumentExtension, type ImportSourceFile, type IntegrationStorageProbeResult, type IntegrationVaultStatus, type McpClientInstallStatus, type McpServerStatus, type McpSettings, type McpStdioLaunchConfig, type SavedTemplate, type TemplateScope, type Workspace, type RecentState } from './backend';
import { loadIntegrationRegistry, type InspectionPrivacyRule, type IntegrationInteractionStepDefinition, type IntegrationRegistry } from './integrationRegistry';
import { defaultColorThemeSettings, type ColorThemeSettings } from './colorTheme';
import type { DebugLogEntry } from './debugLog';
import type { HvyMode, MountedDocument } from './hvy';
import type { HvyDocumentSearchMode, HvySearchSnapshot, SearchFilterMode } from '../../heavy-file-format/src/search/types';
import type { WorkspaceEmbeddingIndexProgress } from './embeddingIndex';
import type { SavedVersion } from './revisionModel';
import type { IntegrationStructuredSource } from './integrationBrowser';
export { findFileInWorkspace, workspaceFileAccessInWorkspaces, workspacePathForFileInWorkspaces } from './workspaceFiles';

export interface OpenDocument {
  documentId: string;
  path: string;
  name: string;
  extension: DocumentExtension;
  virtual?: 'workspaceChat' | 'versionHistory' | 'recoveryDraft' | 'defaultDocument';
  historySourcePath?: string;
  historySourceName?: string;
  historyVersionId?: string;
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  hiddenFromAI: boolean;
  isNew: boolean;
  metaOpen: boolean;
  mounted: MountedDocument | null;
  recoveryBackupId: string | null;
  recoveryModified: boolean;
}

export interface OpenDocumentTab {
  path: string;
  name: string;
  dirty: boolean;
  readOnly: boolean;
  hiddenFromAI: boolean;
  active: boolean;
}

export interface AppState {
  workspaces: Workspace[];
  workspaceEntries: WorkspaceEntry[];
  archivedWorkspaces: ArchivedWorkspace[];
  selectedWorkspacePath: string | null;
  selectedFilePath: string | null;
  recent: RecentState;
  appSettings: AppSettings;
  aiSettings: AiSettings;
  mcpSettings: McpSettings;
  mcpServerStatus: McpServerStatus;
  mcpStdioLaunchConfig: McpStdioLaunchConfig;
  mcpClientInstallStatus: McpClientInstallStatus[];
  colorTheme: ColorThemeSettings;
  savedTemplates: SavedTemplate[];
  document: OpenDocument | null;
  documentTabs: OpenDocumentTab[];
  status: string;
  error: string | null;
  busy: boolean;
  newWorkspaceDialogOpen: boolean;
  workspaceInitializationDialogOpen: boolean;
  workspaceInitializationPath: string | null;
  workspaceInitializationName: string | null;
  workspaceManagerOpen: boolean;
  openWorkspaceActionsPath: string | null;
  newFolderWorkspacePath: string | null;
  newFolderParentDirectory: string;
  workspaceExpanded: Record<string, boolean>;
  workspaceFolderExpanded: Record<string, Record<string, boolean>>;
  newWorkspaceLocation: 'managed' | 'choose';
  newDocumentWorkspacePath: string | null;
  newDocumentDirectory: string;
  newDocumentType: DocumentCreationType;
  importWorkspacePath: string | null;
  importDirectory: string;
  importDocumentType: DocumentCreationType;
  importIntoCurrentDialogOpen: boolean;
  importSourceTab: 'workspace' | 'anywhere';
  importSource: ImportSourceFile | null;
  importSourceTextDraft: string;
  importOutputMode: 'current' | 'workspace';
  importExcludeTags: string;
  importNewSectionsOnly: boolean;
  importProgressDialogOpen: boolean;
  saveTemplateScope: TemplateScope;
  saveAsDialogOpen: boolean;
  saveAsKind: 'document' | 'template';
  saveAsScope: 'workspace' | 'anywhere';
  exportPdfSavePromptOpen: boolean;
  exportedPdfPath: string | null;
  appSettingsDialogOpen: boolean;
  integrationsDialogOpen: boolean;
  integrationStorageProbeResult: IntegrationStorageProbeResult | null;
  integrationInspectionResult: unknown;
  integrationVaultStatus: IntegrationVaultStatus | null;
  integrationVaultResetDialogOpen: boolean;
  integrationRegistry: IntegrationRegistry;
  addIntegrationPageDialogOpen: boolean;
  inspectionPrivacyRules: InspectionPrivacyRule[];
  integrationActionBuilderOpen: boolean;
  integrationActionDiscardDialogOpen: boolean;
  integrationActionExamples: unknown[];
  integrationActionExampleRules: InspectionPrivacyRule[][];
  integrationActionTargetLabels: string[];
  integrationActionTargetIds: string[];
  integrationActionTargetCardinalities: Array<'single' | 'list'>;
  integrationActionTargetOptional: boolean[];
  integrationActionTargetParentIndexes: number[];
  integrationActionTargetSelectionParentIndex: number;
  integrationActionTargetSelectionFieldIndex: number | null;
  integrationActionTargetVariants: unknown[][];
  integrationActionTargetNegativeVariants: unknown[][];
  integrationActionTargetAbsentExamples: boolean[][];
  integrationActionSelectedParentIndex: number;
  integrationActionMinimumConfidence: number;
  integrationActionAnchors: unknown[];
  integrationActionAnchorRules: InspectionPrivacyRule[][];
  integrationActionSelectionKind: 'parent' | 'target' | 'example';
  integrationActionSelectionPending: boolean;
  integrationActionDraftIntegrationId: string | null;
  integrationActionDraftPageId: string | null;
  integrationActionDraftActionId: string | null;
  integrationActionBuilderStep: 'define' | 'preview' | 'save';
  integrationActionDraftName: string;
  integrationActionDraftDescription: string;
  integrationActionBuilderInitialJson: string;
  integrationActionPreviewRecords: unknown[];
  integrationActionLiveExampleRecords: unknown[];
  integrationActionPreviewDiagnostics: unknown;
  integrationActionPreviewPending: boolean;
  integrationActionEditPageLoading: boolean;
  integrationActionResultOpen: boolean;
  integrationActionResultName: string;
  integrationActionResultRecords: unknown[];
  integrationActionResultActionId: string | null;
  integrationActionFetchPendingId: string | null;
  integrationActionFetchError: string | null;
  integrationStructuredSourcePageId: string | null;
  integrationStructuredSourcePending: boolean;
  integrationStructuredSources: IntegrationStructuredSource[];
  integrationStructuredSourceError: string | null;
  integrationStructuredResultOpen: boolean;
  integrationStructuredResultName: string;
  integrationStructuredResult: unknown;
  integrationCommandBuilderOpen: boolean;
  integrationCommandSelectionPending: boolean;
  integrationCommandDraftIntegrationId: string | null;
  integrationCommandDraftActionId: string | null;
  integrationCommandDraftPageId: string | null;
  integrationCommandDraftScope: 'page' | 'record';
  integrationCommandDraftSteps: IntegrationInteractionStepDefinition[];
  integrationCommandRunRequest: { integrationId: string; actionId?: string; pageId?: string; commandId: string; recordParent?: string } | null;
  integrationCommandDeleteDialogOpen: boolean;
  integrationCommandDeleteIntegrationId: string | null;
  integrationCommandDeleteActionId: string | null;
  integrationCommandDeleteCommandId: string | null;
  integrationRecordDeleteDialogOpen: boolean;
  integrationRecordDeleteIntegrationId: string | null;
  integrationRecordDeleteActionId: string | null;
  selectedIntegrationId: string;
  selectedIntegrationProfileId: string;
  addIntegrationProfileDialogOpen: boolean;
  appSettingsDialogMode: 'settings' | 'plugins';
  appSettingsDraft: AppSettings | null;
  appSettingsDialogInitialJson: string | null;
  appSettingsDiscardDialogOpen: boolean;
  scriptingReviewDialogOpen: boolean;
  aiSettingsDialogOpen: boolean;
  aiSettingsDraft: AiSettings | null;
  aiSettingsDialogInitialJson: string | null;
  aiSettingsDiscardDialogOpen: boolean;
  aiSettingsSelectedProviderId: string | null;
  mcpSettingsDialogOpen: boolean;
  mcpSettingsDraft: McpSettings | null;
  mcpSettingsDialogInitialJson: string | null;
  mcpSettingsDiscardDialogOpen: boolean;
  colorThemeDialogOpen: boolean;
  colorThemeDialogMode: 'global' | 'document';
  aboutDialogOpen: boolean;
  debugLogDialogOpen: boolean;
  debugLogEntries: DebugLogEntry[];
  recoveryDialogOpen: boolean;
  versionHistoryDialogOpen: boolean;
  savedDocumentVersions: SavedVersion[];
  selectedSavedVersionId: string | null;
  closeDocumentDialogOpen: boolean;
  closeDocumentTargetPath: string | null;
  closeDocumentDraftDialogOpen: boolean;
  saveConflictDialogOpen: boolean;
  saveConflictKind: import('./recoveryDocuments').SaveConflictKind | null;
  saveConflictSavingDocumentId: string | null;
  saveConflictOtherDocumentId: string | null;
  saveConflictContinuation: 'save' | 'saveAndCloseDocument' | 'saveBeforeExportPdf' | 'saveAndCloseApp';
  tabStackOpen: boolean;
  tabStackIndex: number;
  appCloseDialogOpen: boolean;
  recoveryBackups: DocumentBackup[];
  workspaceClipboard: WorkspaceClipboardState | null;
  renameFilePath: string | null;
  renameFileCurrentName: string | null;
  deleteFilePath: string | null;
  deleteFileName: string | null;
  deleteFolderWorkspacePath: string | null;
  deleteFolderDirectory: string;
  deleteFolderName: string | null;
  deleteFolderArchivedFiles: string[];
  workspaceTransfer: WorkspaceTransferState | null;
  workspaceFilter: WorkspaceFilterState;
  workspaceChat: WorkspaceChatState;
  workspaceEmbeddingPreviews: Record<string, WorkspaceEmbeddingPreviewState>;
  workspaceFilters: Record<string, WorkspaceFilterConfig>;
  workspaceFileViews: Record<string, WorkspaceFileView>;
  appZoom: number;
  documentZoom: number;
}

export interface WorkspaceEntry {
  path: string;
  displayName: string;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

export type WorkspaceFileView = 'documents' | 'templates';

export interface WorkspaceFilterConfig {
  query: string;
  mode: HvyDocumentSearchMode;
  filterMode: SearchFilterMode;
  targetDirectory: string;
  snapshots: Record<string, HvySearchSnapshot>;
}

export interface WorkspaceFilterState {
  open: boolean;
  workspacePath: string | null;
  targetDirectory: string;
  queryDraft: string;
  submittedQuery: string;
  mode: HvyDocumentSearchMode;
  filterMode: SearchFilterMode;
  isLoading: boolean;
  status: string | null;
  error: string | null;
}

export interface WorkspaceChatSource {
  id: string;
  label: string;
  detail: string;
  path: string;
  href: string;
  score: number;
  excerpt: string;
}

export interface WorkspaceChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

export interface WorkspaceChatState {
  open: boolean;
  workspacePath: string | null;
  targetDirectory: string;
  scopeLabel: string;
  status: string | null;
  error: string | null;
  dirty: boolean;
  closePromptOpen: boolean;
  isSending: boolean;
  draft: string;
  progress: WorkspaceEmbeddingIndexProgress | null;
  messages: WorkspaceChatMessage[];
}

export interface WorkspaceEmbeddingPreviewState {
  enabled: boolean;
  loading: boolean;
  sidecars: Record<string, boolean>;
  error: string | null;
}

export interface WorkspaceTransferState {
  mode: 'saveCurrent' | 'copyFile' | 'moveFile';
  sourcePath: string | null;
  fileName: string;
  nameDraft: string;
  excludedWorkspacePath: string | null;
  targetDirectory: string;
}

export interface WorkspaceClipboardState {
  mode: 'copy' | 'cut';
  path: string;
  name: string;
}

export const state: AppState = {
  workspaces: [],
  workspaceEntries: [],
  archivedWorkspaces: [],
  selectedWorkspacePath: null,
  selectedFilePath: null,
  recent: { workspaces: [], files: [] },
  appSettings: defaultAppSettings(),
  aiSettings: defaultAiSettings(),
  mcpSettings: defaultMcpSettings(),
  mcpServerStatus: defaultMcpServerStatus(),
  mcpStdioLaunchConfig: defaultMcpStdioLaunchConfig(),
  mcpClientInstallStatus: defaultMcpClientInstallStatus(),
  colorTheme: defaultColorThemeSettings(),
  savedTemplates: [],
  document: null,
  documentTabs: [],
  status: 'Ready',
  error: null,
  busy: false,
  newWorkspaceDialogOpen: false,
  workspaceInitializationDialogOpen: false,
  workspaceInitializationPath: null,
  workspaceInitializationName: null,
  workspaceManagerOpen: false,
  openWorkspaceActionsPath: null,
  newFolderWorkspacePath: null,
  newFolderParentDirectory: '',
  workspaceExpanded: {},
  workspaceFolderExpanded: {},
  newWorkspaceLocation: 'managed',
  newDocumentWorkspacePath: null,
  newDocumentDirectory: '',
  newDocumentType: 'hvy',
  importWorkspacePath: null,
  importDirectory: '',
  importDocumentType: 'hvy',
  importIntoCurrentDialogOpen: false,
  importSourceTab: 'workspace',
  importSource: null,
  importSourceTextDraft: '',
  importOutputMode: 'current',
  importExcludeTags: '',
  importNewSectionsOnly: false,
  importProgressDialogOpen: false,
  saveTemplateScope: 'app',
  saveAsDialogOpen: false,
  saveAsKind: 'document',
  saveAsScope: 'workspace',
  exportPdfSavePromptOpen: false,
  exportedPdfPath: null,
  appSettingsDialogOpen: false,
  integrationsDialogOpen: false,
  integrationStorageProbeResult: null,
  integrationInspectionResult: null,
  integrationVaultStatus: null,
  integrationVaultResetDialogOpen: false,
  integrationRegistry: loadIntegrationRegistry(),
  addIntegrationPageDialogOpen: false,
  inspectionPrivacyRules: [],
  integrationActionBuilderOpen: false,
  integrationActionDiscardDialogOpen: false,
  integrationActionExamples: [],
  integrationActionExampleRules: [],
  integrationActionTargetLabels: [],
  integrationActionTargetIds: [],
  integrationActionTargetCardinalities: [],
  integrationActionTargetOptional: [],
  integrationActionTargetParentIndexes: [],
  integrationActionTargetSelectionParentIndex: 0,
  integrationActionTargetSelectionFieldIndex: null,
  integrationActionTargetVariants: [],
  integrationActionTargetNegativeVariants: [],
  integrationActionTargetAbsentExamples: [],
  integrationActionSelectedParentIndex: 0,
  integrationActionMinimumConfidence: 0.8,
  integrationActionAnchors: [],
  integrationActionAnchorRules: [],
  integrationActionSelectionKind: 'parent',
  integrationActionSelectionPending: false,
  integrationActionDraftIntegrationId: null,
  integrationActionDraftPageId: null,
  integrationActionDraftActionId: null,
  integrationActionBuilderStep: 'define',
  integrationActionDraftName: '',
  integrationActionDraftDescription: '',
  integrationActionBuilderInitialJson: '',
  integrationActionPreviewRecords: [],
  integrationActionLiveExampleRecords: [],
  integrationActionPreviewDiagnostics: null,
  integrationActionPreviewPending: false,
  integrationActionEditPageLoading: false,
  integrationActionResultOpen: false,
  integrationActionResultName: '',
  integrationActionResultRecords: [],
  integrationActionResultActionId: null,
  integrationActionFetchPendingId: null,
  integrationActionFetchError: null,
  integrationStructuredSourcePageId: null,
  integrationStructuredSourcePending: false,
  integrationStructuredSources: [],
  integrationStructuredSourceError: null,
  integrationStructuredResultOpen: false,
  integrationStructuredResultName: '',
  integrationStructuredResult: null,
  integrationCommandBuilderOpen: false,
  integrationCommandSelectionPending: false,
  integrationCommandDraftIntegrationId: null,
  integrationCommandDraftActionId: null,
  integrationCommandDraftPageId: null,
  integrationCommandDraftScope: 'record',
  integrationCommandDraftSteps: [],
  integrationCommandRunRequest: null,
  integrationCommandDeleteDialogOpen: false,
  integrationCommandDeleteIntegrationId: null,
  integrationCommandDeleteActionId: null,
  integrationCommandDeleteCommandId: null,
  integrationRecordDeleteDialogOpen: false,
  integrationRecordDeleteIntegrationId: null,
  integrationRecordDeleteActionId: null,
  selectedIntegrationId: 'gmail',
  selectedIntegrationProfileId: 'default-google',
  addIntegrationProfileDialogOpen: false,
  appSettingsDialogMode: 'settings',
  appSettingsDraft: null,
  appSettingsDialogInitialJson: null,
  appSettingsDiscardDialogOpen: false,
  scriptingReviewDialogOpen: false,
  aiSettingsDialogOpen: false,
  aiSettingsDraft: null,
  aiSettingsDialogInitialJson: null,
  aiSettingsDiscardDialogOpen: false,
  aiSettingsSelectedProviderId: null,
  mcpSettingsDialogOpen: false,
  mcpSettingsDraft: null,
  mcpSettingsDialogInitialJson: null,
  mcpSettingsDiscardDialogOpen: false,
  colorThemeDialogOpen: false,
  colorThemeDialogMode: 'global',
  aboutDialogOpen: false,
  debugLogDialogOpen: false,
  debugLogEntries: [],
  recoveryDialogOpen: false,
  versionHistoryDialogOpen: false,
  savedDocumentVersions: [],
  selectedSavedVersionId: null,
  closeDocumentDialogOpen: false,
  closeDocumentTargetPath: null,
  closeDocumentDraftDialogOpen: false,
  saveConflictDialogOpen: false,
  saveConflictKind: null,
  saveConflictSavingDocumentId: null,
  saveConflictOtherDocumentId: null,
  saveConflictContinuation: 'save',
  tabStackOpen: false,
  tabStackIndex: 0,
  appCloseDialogOpen: false,
  recoveryBackups: [],
  workspaceClipboard: null,
  renameFilePath: null,
  renameFileCurrentName: null,
  deleteFilePath: null,
  deleteFileName: null,
  deleteFolderWorkspacePath: null,
  deleteFolderDirectory: '',
  deleteFolderName: null,
  deleteFolderArchivedFiles: [],
  workspaceTransfer: null,
  workspaceFilter: {
    open: false,
    workspacePath: null,
    targetDirectory: '',
    queryDraft: '',
    submittedQuery: '',
    mode: 'keyword',
    filterMode: 'deprioritize',
    isLoading: false,
    status: null,
    error: null,
  },
  workspaceChat: {
    open: false,
    workspacePath: null,
    targetDirectory: '',
    scopeLabel: '',
    status: null,
    error: null,
    dirty: false,
    closePromptOpen: false,
    isSending: false,
    draft: '',
    progress: null,
    messages: [],
  },
  workspaceEmbeddingPreviews: {},
  workspaceFilters: {},
  workspaceFileViews: {},
  appZoom: 1,
  documentZoom: 1,
};
