const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard } = require('electron');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const WORKSPACE_MANIFEST = '.hvyworkspace.json';
const LEGACY_WORKSPACE_MANIFEST = '.hvygalaxy.json';
const RECENT_STATE = 'recent.json';
const ARCHIVED_WORKSPACES = 'archived-workspaces.json';
const AI_SETTINGS = 'ai-settings.json';
const MCP_SETTINGS = 'mcp-settings.json';
const RECENT_LIMIT = 12;
const DEFAULT_AI_MAX_CONTEXT_CHARS = 40000;
const AI_MIN_CONTEXT_CHARS = 1000;
const AI_MAX_CONTEXT_CHARS = 750000;
const AI_CONTEXT_STEP_CHARS = 1000;
const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DOCUMENT_EXTENSIONS = new Set(['.hvy', '.thvy', '.phvy', '.md']);
const IMPORT_SOURCE_EXTENSIONS = new Set(['.hvy', '.thvy', '.phvy', '.txt', '.md', '.pdf', '.docx']);
const TEMPLATE_EXTENSIONS = new Set(['.thvy', '.phvy']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const THEME_EXTENSIONS = new Set(['.hvytheme', '.json']);
const APP_IDENTIFIER = 'com.heavyresume.hvy-galaxy';
const APP_NAME = 'HVY Galaxy';
const runFile = promisify(execFile);

let mainWindow = null;
let appCloseAllowed = false;
let nativeQuitRequested = false;
let fileMenuState = defaultFileMenuState();
let pendingLaunchDocumentPaths = launchDocumentPathsFromArgv(process.argv);
let rendererAcceptsOpenDocumentPaths = false;
let mcpStatus = {
  running: false,
  url: null,
  message: 'MCP server is stopped.',
  lastError: null,
};

app.setName(APP_NAME);
app.setAppUserModelId(APP_IDENTIFIER);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
  iconPath: iconPath(appIconFileName()),
});
app.setPath('userData', electronProfileDir());

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  enqueueOpenDocumentPath(filePath);
});

app.whenReady().then(async () => {
  mainWindow = createWindow();
  bindWindowShortcuts(mainWindow);
  buildMenu();
  await loadRenderer(mainWindow);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      bindWindowShortcuts(mainWindow);
      buildMenu();
      await loadRenderer(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (appCloseAllowed) return;
  event.preventDefault();
  requestNativeAppClose({ quit: true });
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#f7f3ea',
    icon: iconPath(appIconFileName()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.on('close', (event) => {
    if (appCloseAllowed) return;
    event.preventDefault();
    requestNativeAppClose({ quit: false });
  });
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    if (!nativeQuitRequested) {
      appCloseAllowed = false;
    }
  });
  return window;
}

function bindWindowShortcuts(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const command = shortcutCommand(input);
    if (!command) return;
    event.preventDefault();
    emitMenu(command);
  });
}

function shortcutCommand(input) {
  if (!input.control && !input.meta) return null;
  if (input.alt || input.isAutoRepeat) return null;
  const key = String(input.key ?? '').toLowerCase();
  if (key === 's' && !input.shift) return fileMenuState.save ? 'save' : null;
  if (key === 's' && input.shift) return fileMenuState.saveAs ? 'save-as' : null;
  if (key === 'w' && !input.shift) return fileMenuState.closeDocument ? 'close-document' : null;
  if (key === 'n' && !input.shift) return 'new-workspace';
  if (key === 'o' && !input.shift) return 'open-workspace';
  if (key === 'o' && input.shift) return 'open-file';
  if (key === 'f' && !input.shift) return 'find';
  if (key === 'b' && !input.shift) return 'bold';
  if (key === 'i' && !input.shift) return 'italic';
  if (key === 'u' && !input.shift) return 'underline';
  if (key === 'x' && input.shift) return 'strikethrough';
  if (key === ',' && !input.shift) return 'ai-settings';
  return null;
}

async function loadRenderer(window) {
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }
  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function buildMenu() {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: APP_NAME,
      submenu: [
        menuItem(`About ${APP_NAME}`, 'about'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        menuItem(`Quit ${APP_NAME}`, 'app-close-requested', 'CmdOrCtrl+Q'),
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        menuItem('New Workspace', 'new-workspace', 'CmdOrCtrl+N'),
        menuItem('Open Workspace', 'open-workspace', 'CmdOrCtrl+O'),
        menuItem('Manage Workspaces...', 'manage-workspaces'),
        menuItem('Open File', 'open-file', 'CmdOrCtrl+Shift+O'),
        recentSubmenu('Recent Workspaces', recent.workspaces, 'recent-workspace:', 'No Recent Workspaces'),
        recentSubmenu('Recent Files', recent.files, 'recent-file:', 'No Recent Files'),
        { type: 'separator' },
        menuItem('Close Document', 'close-document', 'CmdOrCtrl+W'),
        menuItem('Save', 'save', 'CmdOrCtrl+S'),
        menuItem('Save As...', 'save-as', 'CmdOrCtrl+Shift+S'),
        menuItem('Save to Workspace...', 'save-to-workspace'),
        menuItem('Export PDF...', 'export-pdf'),
        menuItem('Import Into Current...', 'import-current'),
        { type: 'separator' },
        menuItem('Recover Unsaved Edits...', 'recover-backup'),
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, menuItem('Quit', 'app-close-requested', 'CmdOrCtrl+Q')]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        menuItem('Undo', 'undo', 'CmdOrCtrl+Z'),
        menuItem('Redo', 'redo', process.platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        menuItem('Bold', 'bold', 'CmdOrCtrl+B'),
        menuItem('Italic', 'italic', 'CmdOrCtrl+I'),
        menuItem('Underline', 'underline', 'CmdOrCtrl+U'),
        menuItem('Strikethrough', 'strikethrough', 'CmdOrCtrl+Shift+X'),
        { type: 'separator' },
        menuItem('Find', 'find', 'CmdOrCtrl+F'),
        { type: 'separator' },
        menuItem('Colors', 'colors'),
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'AI',
      submenu: [
        menuItem('LLM Settings...', 'ai-settings', 'CmdOrCtrl+,'),
        menuItem('MCP Settings...', 'mcp-settings'),
      ],
    },
    {
      label: 'Help',
      submenu: [
        menuItem('HVY Guide', 'open-guide', 'F1'),
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, menuItem(`About ${APP_NAME}`, 'about')]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function menuItem(label, id, accelerator) {
  return {
    label,
    id,
    accelerator,
    enabled: fileMenuItemEnabled(id),
    click: () => emitMenu(id),
  };
}

function fileMenuItemEnabled(id) {
  if (id === 'close-document') return fileMenuState.closeDocument;
  if (id === 'save') return fileMenuState.save;
  if (id === 'save-as') return fileMenuState.saveAs;
  if (id === 'save-to-workspace') return fileMenuState.saveToWorkspace;
  if (id === 'export-pdf') return fileMenuState.exportPdf;
  if (id === 'import-current') return fileMenuState.importCurrent;
  return true;
}

function recentSubmenu(label, entries, prefix, emptyLabel = 'No Recent Items') {
  const submenu = [
    { id: `${prefix}empty`, label: emptyLabel, enabled: false, visible: entries.length === 0 },
    ...Array.from({ length: RECENT_LIMIT }, (_value, index) => ({
      id: `${prefix}${index}`,
      label: entries[index] ? menuLabel(entries[index]) : emptyLabel,
      visible: Boolean(entries[index]),
      click: () => emitRecent(prefix, index),
    })),
  ];
  return { id: `${prefix}menu`, label, submenu };
}

function emitMenu(payload) {
  if (payload === 'app-close-requested') {
    requestNativeAppClose({ quit: true });
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('hvy:menu-event', payload);
}

function requestNativeAppClose({ quit }) {
  nativeQuitRequested = quit;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hvy:app-close-requested');
    return;
  }
  if (quit) {
    appCloseAllowed = true;
    app.quit();
  }
}

function enqueueOpenDocumentPath(filePath) {
  const documentPath = launchDocumentPath(filePath);
  if (!documentPath) return;
  if (rendererAcceptsOpenDocumentPaths && mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('hvy:open-document-path', documentPath);
    return;
  }
  pendingLaunchDocumentPaths.push(documentPath);
}

function loadLaunchDocumentPaths() {
  rendererAcceptsOpenDocumentPaths = true;
  const paths = pendingLaunchDocumentPaths;
  pendingLaunchDocumentPaths = [];
  return paths;
}

function emitRecent(prefix, index) {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  const entries = prefix === 'recent-file:' ? recent.files : recent.workspaces;
  const entry = entries?.[index];
  if (entry) emitMenu(`${prefix}${entry}`);
}

function refreshMenu() {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    buildMenu();
    return;
  }
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  refreshRecentSubmenu(menu, 'recent-file:', recent.files || [], 'No Recent Files');
  refreshRecentSubmenu(menu, 'recent-workspace:', recent.workspaces || [], 'No Recent Workspaces');
  refreshFileMenuState(menu);
}

function refreshRecentSubmenu(menu, prefix, entries, emptyLabel) {
  const empty = menu.getMenuItemById(`${prefix}empty`);
  if (empty) empty.visible = entries.length === 0;
  for (let index = 0; index < RECENT_LIMIT; index += 1) {
    const item = menu.getMenuItemById(`${prefix}${index}`);
    if (!item) continue;
    const entry = entries[index];
    item.label = entry ? menuLabel(entry) : emptyLabel;
    item.visible = Boolean(entry);
  }
}

function updateFileMenuState(nextState) {
  fileMenuState = normalizeFileMenuState(nextState);
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    buildMenu();
    return;
  }
  refreshFileMenuState(menu);
}

function refreshFileMenuState(menu) {
  for (const [id, enabled] of Object.entries(fileMenuStateEntries(fileMenuState))) {
    const item = menu.getMenuItemById(id);
    if (item) item.enabled = enabled;
  }
}

function defaultFileMenuState() {
  return {
    closeDocument: false,
    save: false,
    saveAs: false,
    saveToWorkspace: false,
    exportPdf: false,
    importCurrent: false,
  };
}

function normalizeFileMenuState(state) {
  const fallback = defaultFileMenuState();
  return {
    closeDocument: Boolean(state?.closeDocument ?? fallback.closeDocument),
    save: Boolean(state?.save ?? fallback.save),
    saveAs: Boolean(state?.saveAs ?? fallback.saveAs),
    saveToWorkspace: Boolean(state?.saveToWorkspace ?? fallback.saveToWorkspace),
    exportPdf: Boolean(state?.exportPdf ?? fallback.exportPdf),
    importCurrent: Boolean(state?.importCurrent ?? fallback.importCurrent),
  };
}

function fileMenuStateEntries(state) {
  return {
    'close-document': state.closeDocument,
    save: state.save,
    'save-as': state.saveAs,
    'save-to-workspace': state.saveToWorkspace,
    'export-pdf': state.exportPdf,
    'import-current': state.importCurrent,
  };
}

ipcMain.handle('hvy:invoke', async (_event, command, args = {}) => {
  try {
    return await handleCommand(command, args);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
});

async function handleCommand(command, args) {
  switch (command) {
    case 'load_recent_state': return readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
    case 'load_ai_settings': return readJson(dataPath(AI_SETTINGS), defaultAiSettings());
    case 'save_ai_settings': return writeJson(dataPath(AI_SETTINGS), normalizeAiSettings(args.settings));
    case 'load_mcp_settings': return readJson(dataPath(MCP_SETTINGS), defaultMcpSettings());
    case 'save_mcp_settings': return writeJson(dataPath(MCP_SETTINGS), normalizeMcpSettings(args.settings));
    case 'load_mcp_server_status': return mcpStatus;
    case 'load_mcp_stdio_launch_config': return defaultMcpStdioLaunchConfig();
    case 'load_mcp_client_install_status': return mcpClientInstallStatuses();
    case 'install_mcp_client': return installMcpClient(args.target);
    case 'remove_mcp_client': return removeMcpClient(args.target);
    case 'restore_mcp_client_backup': return restoreMcpClientBackup(args.target);
    case 'start_mcp_server':
      mcpStatus = { running: false, url: null, message: 'MCP stdio is available through client install.', lastError: null };
      refreshMenu();
      return mcpStatus;
    case 'stop_mcp_server':
      mcpStatus = { running: false, url: null, message: 'MCP server is stopped.', lastError: null };
      refreshMenu();
      return mcpStatus;
    case 'update_mcp_workspaces': return null;
    case 'load_default_guide': return readDocumentAt(defaultGuidePath());
    case 'open_workspace_dialog': return openWorkspaceDialog();
    case 'choose_workspace_folder': return chooseWorkspaceFolder();
    case 'create_workspace': return createWorkspace(args.name);
    case 'new_workspace_dialog': return newWorkspaceDialog();
    case 'initialize_workspace_path': return initializeWorkspacePath(args.path);
    case 'load_workspace': return loadWorkspace(args.path, args.includeTemplates === true);
    case 'load_archived_workspaces': return loadArchivedWorkspaces();
    case 'rename_workspace': return renameWorkspace(args.path, args.name);
    case 'archive_workspace': return archiveWorkspace(args.path);
    case 'unarchive_workspace': return unarchiveWorkspace(args.path);
    case 'add_files_to_workspace': return addFilesToWorkspace(args.workspacePath);
    case 'add_dropped_files_to_workspace': return addDroppedFilesToWorkspace(args.workspacePath, args.files);
    case 'open_file_dialog': return openFileDialog();
    case 'open_import_source_dialog': return openImportSourceDialog();
    case 'load_launch_document_paths': return loadLaunchDocumentPaths();
    case 'read_document_file': return readDocumentFile(args.path);
    case 'save_document_file': return saveDocumentFile(args.path, args.bytes);
    case 'save_document_as_dialog': return saveDocumentAsDialog(args.suggestedName, args.bytes);
    case 'save_pdf_as_dialog': return savePdfAsDialog(args.suggestedName, args.bytes);
    case 'list_saved_templates': return listSavedTemplates(args.workspacePath);
    case 'save_document_template': return saveDocumentTemplate(args.request);
    case 'update_workspace_template_visibility': return updateWorkspaceTemplateVisibility(args.workspacePath, args.templateVisibility);
    case 'update_workspace_file_ai_access': return updateWorkspaceFileAiAccess(args.path, args.updates);
    case 'open_color_theme_dialog': return openColorThemeDialog();
    case 'save_color_theme_as_dialog': return saveColorThemeAsDialog(args.suggestedName, args.bytes);
    case 'update_file_menu_state': return updateFileMenuState(args.state);
    case 'create_document_file': return createDocumentFile(args.workspacePath, args.relativePath, args.template);
    case 'reveal_document_file': return revealDocumentFile(args.path);
    case 'open_document_file': return openDocumentFile(args.path);
    case 'rename_document_file': return renameDocumentFile(args.path, args.name);
    case 'archive_document_file': return archiveDocumentFile(args.path);
    case 'restore_document_file': return restoreDocumentFile(args.path);
    case 'delete_document_file': return deleteDocumentFile(args.path);
    case 'save_document_to_workspace': return saveDocumentToWorkspace(args.workspacePath, args.name, args.bytes);
    case 'copy_document_to_workspace': return copyDocumentToWorkspace(args.path, args.workspacePath);
    case 'move_document_to_workspace': return moveDocumentToWorkspace(args.path, args.workspacePath);
    case 'write_system_file_clipboard': return writeSystemFileClipboard(args.request);
    case 'paste_system_files_to_workspace': return pasteSystemFilesToWorkspace(args.workspacePath);
    case 'create_document_backup': return createDocumentBackup(args.request);
    case 'list_document_backups': return listDocumentBackups();
    case 'restore_document_backup': return restoreDocumentBackup(args.id);
    case 'discard_document_backup': return discardDocumentBackup(args.id);
    case 'clear_document_recovery_drafts': return clearDocumentRecoveryDrafts(args.request);
    case 'open_external_url': return openExternalUrl(args.url);
    case 'close_app_window': return closeAppWindow();
    default: throw new Error(`Unknown Electron command: ${command}`);
  }
}

function closeAppWindow() {
  appCloseAllowed = true;
  if (nativeQuitRequested || process.platform !== 'darwin') {
    app.quit();
    return null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    return null;
  }
  return null;
}

function dataPath(fileName) {
  return path.join(sharedAppDataDir(), fileName);
}

function appTemplatesDir() {
  return path.join(sharedAppDataDir(), 'templates');
}

function workspaceTemplatesDir(workspacePath) {
  return path.join(workspacePath, 'templates');
}

function backupsDir() {
  return path.join(sharedAppDataDir(), 'backups');
}

function defaultGuidePath() {
  const packaged = path.join(process.resourcesPath || '', 'resources', 'hvy-guide.hvy');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'src-tauri', 'resources', 'hvy-guide.hvy');
}

function sharedAppDataDir() {
  if (process.env.HVY_GALAXY_APP_DATA_DIR) {
    return process.env.HVY_GALAXY_APP_DATA_DIR;
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_IDENTIFIER);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_IDENTIFIER);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP_IDENTIFIER);
}

function electronProfileDir() {
  if (process.env.HVY_GALAXY_ELECTRON_PROFILE_DIR) {
    return process.env.HVY_GALAXY_ELECTRON_PROFILE_DIR;
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', `${APP_NAME} Electron`);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), `${APP_NAME} Electron`);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), `${APP_NAME} Electron`);
}

function iconPath(fileName) {
  const packaged = path.join(process.resourcesPath || '', 'icons', fileName);
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'src-tauri', 'icons', fileName);
}

function appIconFileName() {
  if (process.platform === 'darwin') return 'icon.icns';
  if (process.platform === 'win32') return 'icon.ico';
  return 'icon.png';
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

async function openWorkspaceDialog() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const workspace = ensureWorkspace(result.filePaths[0]);
  addRecentWorkspace(result.filePaths[0]);
  return workspace;
}

async function chooseWorkspaceFolder() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0];
  return {
    path: selected,
    hasManifest: Boolean(workspaceManifestPath(selected)),
    defaultName: path.basename(selected) || 'Untitled Workspace',
  };
}

function createWorkspace(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Workspace name is required.');
  const root = uniqueManagedWorkspacePath(trimmed);
  fs.mkdirSync(root, { recursive: true });
  const workspace = initializeWorkspaceWithName(root, trimmed);
  addRecentWorkspace(root);
  return workspace;
}

async function newWorkspaceDialog() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const workspace = initializeWorkspacePath(result.filePaths[0]);
  addRecentWorkspace(result.filePaths[0]);
  return workspace;
}

function initializeWorkspacePath(selectedPath) {
  const workspace = initializeWorkspaceWithName(selectedPath, null);
  addRecentWorkspace(selectedPath);
  return workspace;
}

function loadWorkspace(selectedPath, includeTemplates = false) {
  const workspace = ensureWorkspace(selectedPath, includeTemplates);
  removeArchivedWorkspace(selectedPath);
  addRecentWorkspace(selectedPath);
  return workspace;
}

function renameWorkspace(workspacePath, name) {
  ensureWorkspace(workspacePath);
  const manifestPath = workspaceManifestPath(workspacePath);
  const manifest = readJson(manifestPath, null);
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Workspace name is required.');
  manifest.name = trimmed;
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
  addRecentWorkspace(workspacePath);
  return loadWorkspaceFromPath(workspacePath);
}

function updateWorkspaceTemplateVisibility(workspacePath, templateVisibility) {
  ensureWorkspace(workspacePath);
  const manifestPath = workspaceManifestPath(workspacePath);
  const manifest = readJson(manifestPath, null);
  manifest.templateVisibility = normalizeTemplateVisibility(templateVisibility);
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
  return loadWorkspaceFromPath(workspacePath);
}

function updateWorkspaceFileAiAccess(filePath, updates) {
  const workspacePath = workspaceRootForDocument(path.dirname(filePath));
  if (!workspacePath) throw new Error('Document must be inside a workspace.');
  if (!documentExtension(filePath)) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be updated.');
  updateWorkspaceFileAiAccessAt(workspacePath, filePath, updates || {});
  return loadWorkspaceFromPath(workspacePath);
}

function archiveWorkspace(workspacePath) {
  const workspace = ensureWorkspace(workspacePath);
  addArchivedWorkspace({
    path: workspace.path,
    name: workspace.manifest.name,
    archivedAt: new Date().toISOString(),
  });
  removeRecentWorkspace(workspacePath);
  return null;
}

function unarchiveWorkspace(workspacePath) {
  const workspace = ensureWorkspace(workspacePath);
  removeArchivedWorkspace(workspacePath);
  addRecentWorkspace(workspacePath);
  return workspace;
}

function loadArchivedWorkspaces() {
  return readJson(dataPath(ARCHIVED_WORKSPACES), [])
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function addFilesToWorkspace(workspacePath) {
  ensureWorkspace(workspacePath);
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported documents', extensions: ['hvy', 'thvy', 'phvy', 'md'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy', 'phvy'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const copiedPaths = [];
  const copiedTemplatePaths = [];
  for (const source of result.filePaths) {
    if (!documentExtension(source)) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be added to a workspace.');
    const isTemplate = TEMPLATE_EXTENSIONS.has(path.extname(source).toLowerCase());
    const destinationRoot = isTemplate ? workspaceTemplatesDir(workspacePath) : workspacePath;
    const destination = uniqueCopyPath(destinationRoot, path.basename(source));
    fs.copyFileSync(source, destination);
    if (isTemplate) {
      copiedTemplatePaths.push(destination);
    } else {
      copiedPaths.push(destination);
      addRecentFile(destination);
    }
  }
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  return {
    workspace: loadWorkspaceFromPath(workspacePath),
    copiedPaths,
    copiedTemplatePaths,
  };
}

function addDroppedFilesToWorkspace(workspacePath, files) {
  ensureWorkspace(workspacePath);
  const copiedPaths = [];
  const copiedTemplatePaths = [];
  for (const file of files || []) {
    if (!documentExtension(file.name)) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be added to a workspace.');
    const isTemplate = TEMPLATE_EXTENSIONS.has(path.extname(file.name).toLowerCase());
    const destinationRoot = isTemplate ? workspaceTemplatesDir(workspacePath) : workspacePath;
    const destination = uniqueCopyPath(destinationRoot, file.name);
    writeBytes(destination, file.bytes);
    if (isTemplate) {
      copiedTemplatePaths.push(destination);
    } else {
      copiedPaths.push(destination);
      addRecentFile(destination);
    }
  }
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  return {
    workspace: loadWorkspaceFromPath(workspacePath),
    copiedPaths,
    copiedTemplatePaths,
  };
}

async function openFileDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Supported documents', extensions: ['hvy', 'thvy', 'phvy', 'md'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy', 'phvy'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readDocumentFile(result.filePaths[0]);
}

async function openImportSourceDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Import sources', extensions: ['hvy', 'thvy', 'phvy', 'txt', 'md', 'pdf', 'docx'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy', 'phvy'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Plain text', extensions: ['txt'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'DocX', extensions: ['docx'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0];
  const extension = path.extname(selected).toLowerCase();
  if (!IMPORT_SOURCE_EXTENSIONS.has(extension)) throw new Error('Only .hvy, .thvy, .phvy, .txt, .md, .pdf, and .docx files can be imported.');
  const source = {
    path: selected,
    name: path.basename(selected),
    extension,
  };
  if (extension === '.txt') {
    source.text = fs.readFileSync(selected, 'utf8');
  } else if (extension === '.pdf') {
    source.text = await extractPdfText(selected);
  } else if (extension === '.docx') {
    source.text = await extractDocxText(selected);
  } else {
    source.bytes = Array.from(fs.readFileSync(selected));
  }
  return source;
}

async function extractPdfText(filePath) {
  const executable = rustHelperPath();
  const { stdout } = await runFile(executable, ['--extract-pdf-text', filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

async function extractDocxText(filePath) {
  const executable = rustHelperPath();
  const { stdout } = await runFile(executable, ['--extract-docx-text', filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function rustHelperPath() {
  if (process.env.HVY_GALAXY_RUST_COMMAND) {
    return process.env.HVY_GALAXY_RUST_COMMAND;
  }
  const name = process.platform === 'win32' ? 'hvy-galaxy.exe' : 'hvy-galaxy';
  const packaged = path.join(process.resourcesPath, name);
  if (fs.existsSync(packaged)) {
    return packaged;
  }
  const devRustLauncher = path.resolve('src-tauri', 'target', 'debug', name);
  if (fs.existsSync(devRustLauncher)) {
    return devRustLauncher;
  }
  return packaged;
}

function readDocumentFile(filePath) {
  const file = readDocumentAt(filePath);
  addRecentFile(filePath);
  return file;
}

function saveDocumentFile(filePath, bytes) {
  writeBytes(filePath, bytes);
  addRecentFile(filePath);
  return null;
}

async function saveDocumentAsDialog(suggestedName, bytes) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName,
    filters: [
      { name: 'Supported documents', extensions: ['hvy', 'thvy', 'phvy', 'md'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy', 'phvy'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  if (!documentExtension(result.filePath)) throw new Error('Save As path must end in .hvy, .thvy, .phvy, or .md.');
  writeBytes(result.filePath, bytes);
  addRecentFile(result.filePath);
  return readDocumentAt(result.filePath);
}

function listSavedTemplates(workspacePath) {
  const templates = [
    ...readTemplatesFrom(appTemplatesDir(), 'app'),
    ...(workspacePath ? readTemplatesFrom(workspaceTemplatesDir(workspacePath), 'workspace') : []),
  ];
  return templates.sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name));
}

function saveDocumentTemplate(request) {
  const directory = request.scope === 'workspace'
    ? workspaceTemplatesDir(request.workspacePath)
    : appTemplatesDir();
  fs.mkdirSync(directory, { recursive: true });
  const fileName = ensureTemplateFileName(request.name, request.extension);
  const filePath = path.join(directory, fileName);
  writeBytes(filePath, request.bytes);
  return readSavedTemplateAt(filePath, request.scope);
}

async function savePdfAsDialog(suggestedName, bytes) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: ensurePdfFileName(suggestedName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  let selected = result.filePath;
  if (!path.extname(selected)) selected = `${selected}.pdf`;
  if (!PDF_EXTENSIONS.has(path.extname(selected).toLowerCase())) {
    throw new Error('PDF export path must end in .pdf.');
  }
  writeBytes(selected, bytes);
  return selected;
}

async function openColorThemeDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'HVY themes', extensions: ['hvytheme'] },
      { name: 'JSON', extensions: ['json'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readThemeAt(result.filePaths[0]);
}

async function saveColorThemeAsDialog(suggestedName, bytes) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: ensureThemeFileName(suggestedName),
    filters: [{ name: 'HVY themes', extensions: ['hvytheme'] }],
  });
  if (result.canceled || !result.filePath) return null;
  let selected = result.filePath;
  if (!path.extname(selected)) selected = `${selected}.hvytheme`;
  if (!THEME_EXTENSIONS.has(path.extname(selected).toLowerCase())) {
    throw new Error('Theme path must end in .hvytheme or .json.');
  }
  writeBytes(selected, bytes);
  return readThemeAt(selected);
}

function createDocumentFile(workspacePath, relativePath, template) {
  const destination = path.resolve(workspacePath, relativePath);
  if (!destination.startsWith(path.resolve(workspacePath) + path.sep)) {
    throw new Error('Document path must stay inside the workspace.');
  }
  if (fs.existsSync(destination)) throw new Error('A document already exists at that path.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, template);
  touchWorkspaceManifest(workspacePath);
  addRecentFile(destination);
  return readDocumentAt(destination);
}

async function revealDocumentFile(filePath) {
  await shell.showItemInFolder(filePath);
  return null;
}

async function openDocumentFile(filePath) {
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
  return null;
}

function renameDocumentFile(filePath, name) {
  const extension = documentExtension(filePath);
  if (!extension) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be renamed.');
  const parent = path.dirname(filePath);
  const stem = normalizedStem(name);
  const destination = path.join(parent, `${stem}${extension}`);
  if (destination === filePath) return readDocumentAt(filePath);
  if (fs.existsSync(destination)) throw new Error('A document with that name already exists.');
  fs.renameSync(filePath, destination);
  const workspacePath = workspaceRootForDocument(parent);
  if (workspacePath) renameWorkspaceFileManifestEntries(workspacePath, filePath, destination);
  addRecentFile(destination);
  return readDocumentAt(destination);
}

function archiveDocumentFile(filePath) {
  const workspacePath = workspaceRootForDocument(path.dirname(filePath));
  if (!workspacePath) throw new Error('Document must be inside a workspace.');
  updateArchivedDocumentFile(workspacePath, filePath, true);
  return loadWorkspaceFromPath(workspacePath);
}

function restoreDocumentFile(filePath) {
  const workspacePath = workspaceRootForDocument(path.dirname(filePath));
  if (!workspacePath) throw new Error('Document must be inside a workspace.');
  updateArchivedDocumentFile(workspacePath, filePath, false);
  return loadWorkspaceFromPath(workspacePath);
}

function deleteDocumentFile(filePath) {
  const workspacePath = workspaceRootForDocument(path.dirname(filePath));
  fs.unlinkSync(filePath);
  if (!workspacePath) return null;
  updateArchivedDocumentFile(workspacePath, filePath, false);
  updateWorkspaceFileAiAccessAt(workspacePath, filePath, { locked: false, hiddenFromAI: false });
  removeRecentFile(filePath);
  return loadWorkspaceFromPath(workspacePath);
}

function saveDocumentToWorkspace(workspacePath, name, bytes) {
  ensureWorkspace(workspacePath);
  const fileName = ensureDocumentFileName(name);
  const destination = uniqueCopyPath(workspacePath, fileName);
  writeBytes(destination, bytes);
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  addRecentFile(destination);
  return readDocumentAt(destination);
}

function copyDocumentToWorkspace(filePath, workspacePath) {
  ensureWorkspace(workspacePath);
  if (!documentExtension(filePath)) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be copied.');
  const destination = uniqueCopyPath(workspacePath, path.basename(filePath));
  fs.copyFileSync(filePath, destination);
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  addRecentFile(destination);
  return readDocumentAt(destination);
}

function moveDocumentToWorkspace(filePath, workspacePath) {
  ensureWorkspace(workspacePath);
  if (!documentExtension(filePath)) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be moved.');
  const sourceWorkspacePath = workspaceRootForDocument(path.dirname(filePath));
  if (path.resolve(path.dirname(filePath)) === path.resolve(workspacePath)) {
    touchWorkspaceManifest(workspacePath);
    addRecentWorkspace(workspacePath);
    addRecentFile(filePath);
    return readDocumentAt(filePath);
  }
  const destination = uniqueCopyPath(workspacePath, path.basename(filePath));
  fs.renameSync(filePath, destination);
  if (sourceWorkspacePath) touchWorkspaceManifest(sourceWorkspacePath);
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  addRecentFile(destination);
  return readDocumentAt(destination);
}

async function writeSystemFileClipboard(request) {
  const paths = Array.isArray(request?.paths) ? request.paths : [];
  const files = paths.map((entry) => String(entry)).filter((entry) => entry && documentExtension(entry) && fs.existsSync(entry));
  if (files.length === 0) throw new Error('No supported document files to copy.');
  if (process.platform !== 'darwin') {
    throw new Error('System file clipboard is currently supported on macOS only.');
  }
  clipboard.clear();
  clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(macFileListPlist(files), 'utf8'));
  clipboard.writeText(files.join('\n'));
}

async function pasteSystemFilesToWorkspace(workspacePath) {
  ensureWorkspace(workspacePath);
  if (process.platform !== 'darwin') {
    throw new Error('System file paste is currently supported on macOS only.');
  }
  const sourcePaths = readMacClipboardFilePaths();
  if (sourcePaths.length === 0) throw new Error('No files are available to paste.');
  const copiedPaths = [];
  for (const source of sourcePaths) {
    if (!documentExtension(source)) continue;
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const destination = uniqueCopyPath(workspacePath, path.basename(source));
    fs.copyFileSync(source, destination);
    copiedPaths.push(destination);
    addRecentFile(destination);
  }
  if (copiedPaths.length === 0) {
    throw new Error('No supported .hvy, .thvy, .phvy, or .md files are available to paste.');
  }
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  return {
    workspace: loadWorkspaceFromPath(workspacePath),
    copiedPaths,
  };
}

function macFileListPlist(files) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${files.map((file) => `  <string>${xmlEscape(file)}</string>`).join('\n')}
</array>
</plist>`;
}

function readMacClipboardFilePaths() {
  const plist = clipboard.readBuffer('NSFilenamesPboardType').toString('utf8');
  const paths = Array.from(plist.matchAll(/<string>([\s\S]*?)<\/string>/g))
    .map((match) => xmlUnescape(match[1]).trim())
    .filter(Boolean);
  if (paths.length > 0) return paths;
  return clipboard.readText()
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('/'));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function createDocumentBackup(request) {
  if (!documentExtension(request.name)) throw new Error('Recovery draft document name must end in .hvy, .thvy, .phvy, or .md.');
  fs.mkdirSync(backupsDir(), { recursive: true });
  pruneDocumentBackups();
  const createdAt = new Date().toISOString();
  const id = crypto.createHash('sha256')
    .update(`${request.documentPath}|${request.name}|${createdAt}`)
    .digest('hex')
    .slice(0, 24);
  const snapshot = { ...request, id, createdAt };
  writeJson(path.join(backupsDir(), `${id}.json`), snapshot);
  return { id, documentPath: request.documentPath, name: request.name, extension: request.extension, createdAt };
}

function listDocumentBackups() {
  pruneDocumentBackups();
  if (!fs.existsSync(backupsDir())) return [];
  const seenDocuments = new Set();
  const backups = [];
  for (const snapshot of fs.readdirSync(backupsDir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(backupsDir(), name), null))
    .filter(Boolean)
    .filter((snapshot) => !documentBackupMatchesSavedFile(snapshot))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    const documentKey = documentBackupKey(snapshot);
    if (seenDocuments.has(documentKey)) continue;
    seenDocuments.add(documentKey);
    backups.push({
      id: snapshot.id,
      documentPath: snapshot.documentPath,
      name: snapshot.name,
      extension: snapshot.extension,
      createdAt: snapshot.createdAt,
    });
  }
  return backups;
}

function restoreDocumentBackup(id) {
  pruneDocumentBackups();
  const snapshot = readJson(path.join(backupsDir(), `${id}.json`), null);
  if (!snapshot) throw new Error('Recovery draft was not found.');
  return {
    path: snapshot.documentPath,
    name: snapshot.name,
    extension: snapshot.extension,
    bytes: snapshot.bytes,
    recoveryState: snapshot.recoveryState ?? null,
  };
}

function discardDocumentBackup(id) {
  const backupPath = path.join(backupsDir(), `${id}.json`);
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
  return null;
}

function documentBackupMatchesSavedFile(snapshot) {
  if (!snapshot.documentPath || !fs.existsSync(snapshot.documentPath)) return false;
  const savedAt = fs.statSync(snapshot.documentPath).mtimeMs;
  const createdAt = Date.parse(snapshot.createdAt);
  if (Number.isFinite(createdAt) && savedAt >= createdAt) return true;
  const savedBytes = fs.readFileSync(snapshot.documentPath);
  return Buffer.compare(savedBytes, Buffer.from(snapshot.bytes || [])) === 0;
}

function documentBackupKey(snapshot) {
  return snapshot.documentPath || `untitled:${snapshot.name}`;
}

function pruneDocumentBackups() {
  const directory = backupsDir();
  if (!fs.existsSync(directory)) return;
  const cutoff = Date.now() - BACKUP_RETENTION_MS;
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const backupPath = path.join(directory, entry);
    const snapshot = readJson(backupPath, null);
    const createdAt = snapshot?.createdAt ? Date.parse(snapshot.createdAt) : NaN;
    if (!Number.isFinite(createdAt) || createdAt < cutoff) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // Best effort cleanup; stale recovery drafts should not block recovery.
      }
    }
  }
}

function clearDocumentRecoveryDrafts(request) {
  const directory = backupsDir();
  if (!fs.existsSync(directory)) return null;
  const key = documentBackupKey(request);
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const draftPath = path.join(directory, entry);
    const snapshot = readJson(draftPath, null);
    if (snapshot && documentBackupKey(snapshot) === key) {
      try {
        fs.unlinkSync(draftPath);
      } catch {
        // Best effort cleanup.
      }
    }
  }
  return null;
}

async function openExternalUrl(url) {
  await shell.openExternal(url);
  return null;
}

function ensureWorkspace(workspacePath, includeTemplates = false) {
  return workspaceManifestPath(workspacePath) ? loadWorkspaceFromPath(workspacePath, includeTemplates) : initializeWorkspaceWithName(workspacePath, null);
}

function initializeWorkspaceWithName(workspacePath, name) {
  fs.mkdirSync(workspacePath, { recursive: true });
  const manifestPath = workspaceManifestPath(workspacePath) || path.join(workspacePath, WORKSPACE_MANIFEST);
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    name: name || path.basename(workspacePath) || 'Untitled Workspace',
    createdAt: now,
    updatedAt: now,
    rootFiles: [],
    expandedPaths: [],
    templateVisibility: normalizeTemplateVisibility(null),
    lockedFiles: [],
    hiddenFromAIFiles: [],
  };
  writeJson(manifestPath, manifest);
  return loadWorkspaceFromPath(workspacePath);
}

function loadWorkspaceFromPath(workspacePath, includeTemplates = false) {
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) throw new Error('Workspace manifest was not found.');
  const manifest = readJson(manifestPath, null);
  return {
    path: workspacePath,
    manifest,
    files: readWorkspaceChildren(workspacePath, workspacePath, manifest, includeTemplates),
  };
}

function workspaceManifestPath(workspacePath) {
  for (const fileName of [WORKSPACE_MANIFEST, LEGACY_WORKSPACE_MANIFEST]) {
    const candidate = path.join(workspacePath, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function touchWorkspaceManifest(workspacePath) {
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) return;
  const manifest = readJson(manifestPath, null);
  if (!manifest) return;
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

function readWorkspaceChildren(root, directory, manifest = {}, includeTemplates = false) {
  const archivedFiles = new Set(manifest?.archivedFiles ?? []);
  const lockedFiles = new Set(manifest?.lockedFiles ?? []);
  const hiddenFromAIFiles = new Set(manifest?.hiddenFromAIFiles ?? []);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && (includeTemplates || path.join(directory, entry.name) !== workspaceTemplatesDir(root)))
    .map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return {
          kind: 'folder',
          name: entry.name,
          path: entryPath,
          relativePath: relativeWorkspacePath(root, entryPath),
          children: readWorkspaceChildren(root, entryPath, manifest, includeTemplates),
        };
      }
      const extension = documentExtension(entryPath);
      if (!extension) return null;
      const relativePath = relativeWorkspacePath(root, entryPath);
      return {
        kind: 'file',
        name: entry.name,
        path: entryPath,
        relativePath,
        extension,
        archived: archivedFiles.has(relativePath),
        locked: lockedFiles.has(relativePath),
        hiddenFromAI: hiddenFromAIFiles.has(relativePath),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function readDocumentAt(filePath) {
  const extension = documentExtension(filePath);
  if (!extension) throw new Error('Only .hvy, .thvy, .phvy, and .md documents can be opened.');
  const access = documentFileAiAccess(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    extension,
    bytes: Array.from(fs.readFileSync(filePath)),
    locked: access.locked,
    hiddenFromAI: access.hiddenFromAI,
  };
}

function documentFileAiAccess(filePath) {
  const workspacePath = workspaceRootForDocument(path.dirname(filePath));
  if (!workspacePath) return { locked: false, hiddenFromAI: false };
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) return { locked: false, hiddenFromAI: false };
  const manifest = readJson(manifestPath, null);
  const relative = relativeWorkspacePath(workspacePath, filePath);
  return {
    locked: (manifest?.lockedFiles ?? []).includes(relative),
    hiddenFromAI: (manifest?.hiddenFromAIFiles ?? []).includes(relative),
  };
}

function readTemplatesFrom(directory, scope) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => TEMPLATE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => readSavedTemplateAt(path.join(directory, name), scope));
}

function readSavedTemplateAt(filePath, scope) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    id: `${scope}:${filePath}`,
    path: filePath,
    name: path.basename(filePath),
    scope,
    extension,
    bytes: Array.from(fs.readFileSync(filePath)),
  };
}

function readThemeAt(filePath) {
  if (!THEME_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error('Theme path must end in .hvytheme or .json.');
  }
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: Array.from(fs.readFileSync(filePath)),
  };
}

function writeBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(bytes));
}

function documentExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return DOCUMENT_EXTENSIONS.has(extension) ? extension : null;
}

function launchDocumentPathsFromArgv(argv) {
  return argv.map((arg) => launchDocumentPath(arg)).filter(Boolean);
}

function launchDocumentPath(value) {
  if (!value || value.startsWith('-')) return null;
  const candidate = path.resolve(value);
  if (!documentExtension(candidate)) return null;
  if (!fs.existsSync(candidate)) return null;
  return candidate;
}

function normalizeTemplateVisibility(value) {
  return {
    hvyDocuments: value?.hvyDocuments !== false,
    thvyTemplates: value?.thvyTemplates !== false,
    phvyTemplates: value?.phvyTemplates !== false,
    archivedFiles: value?.archivedFiles === true,
  };
}

function updateArchivedDocumentFile(workspacePath, filePath, archived) {
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) throw new Error('Workspace manifest was not found.');
  const manifest = readJson(manifestPath, null);
  const relative = relativeWorkspacePath(workspacePath, filePath);
  const archivedFiles = new Set(manifest.archivedFiles ?? []);
  if (archived) archivedFiles.add(relative);
  else archivedFiles.delete(relative);
  manifest.archivedFiles = [...archivedFiles].sort();
  if (manifest.archivedFiles.length === 0) delete manifest.archivedFiles;
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

function updateWorkspaceFileAiAccessAt(workspacePath, filePath, updates) {
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) throw new Error('Workspace manifest was not found.');
  const manifest = readJson(manifestPath, null);
  const relative = relativeWorkspacePath(workspacePath, filePath);
  if (typeof updates.locked === 'boolean') {
    updateManifestFileSet(manifest, 'lockedFiles', relative, updates.locked);
  }
  if (typeof updates.hiddenFromAI === 'boolean') {
    updateManifestFileSet(manifest, 'hiddenFromAIFiles', relative, updates.hiddenFromAI);
  }
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

function renameWorkspaceFileManifestEntries(workspacePath, previousPath, nextPath) {
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) return;
  const manifest = readJson(manifestPath, null);
  const previous = relativeWorkspacePath(workspacePath, previousPath);
  const next = relativeWorkspacePath(workspacePath, nextPath);
  renameManifestFileSetEntry(manifest, 'archivedFiles', previous, next);
  renameManifestFileSetEntry(manifest, 'lockedFiles', previous, next);
  renameManifestFileSetEntry(manifest, 'hiddenFromAIFiles', previous, next);
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

function renameManifestFileSetEntry(manifest, key, previous, next) {
  const files = new Set(manifest[key] ?? []);
  if (!files.has(previous)) return;
  files.delete(previous);
  files.delete(next);
  files.add(next);
  manifest[key] = [...files].sort();
  if (manifest[key].length === 0) delete manifest[key];
}

function updateManifestFileSet(manifest, key, relative, enabled) {
  const files = new Set(manifest[key] ?? []);
  if (enabled) files.add(relative);
  else files.delete(relative);
  manifest[key] = [...files].sort();
  if (manifest[key].length === 0) delete manifest[key];
}

function relativeWorkspacePath(root, entryPath) {
  return path.relative(root, entryPath).replace(/\\/g, '/');
}

function ensureDocumentFileName(name) {
  const base = safeFileStem(name || 'Untitled');
  return DOCUMENT_EXTENSIONS.has(path.extname(base).toLowerCase()) ? base : `${base}.hvy`;
}

function uniqueManagedWorkspacePath(name) {
  const root = path.join(sharedAppDataDir(), 'workspaces');
  fs.mkdirSync(root, { recursive: true });
  const base = workspaceFolderName(name);
  let candidate = path.join(root, base);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${base}-${index}`);
    index += 1;
  }
  return candidate;
}

function workspaceFolderName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

function uniqueCopyPath(root, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(root, fileName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${parsed.name} ${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function ensureTemplateFileName(name, requestedExtension = '.thvy') {
  const base = safeFileStem(name || 'Template');
  const extension = path.extname(base).toLowerCase();
  const targetExtension = TEMPLATE_EXTENSIONS.has(requestedExtension) ? requestedExtension : '.thvy';
  if (TEMPLATE_EXTENSIONS.has(extension) || DOCUMENT_EXTENSIONS.has(extension)) {
    return `${path.parse(base).name}${targetExtension}`;
  }
  return `${base}${targetExtension}`;
}

function ensurePdfFileName(name) {
  const base = safeFileStem(name || 'document.pdf');
  return PDF_EXTENSIONS.has(path.extname(base).toLowerCase()) ? base : `${base}.pdf`;
}

function ensureThemeFileName(name) {
  const base = safeFileStem(name || 'Theme');
  return THEME_EXTENSIONS.has(path.extname(base).toLowerCase()) ? base : `${base}.hvytheme`;
}

function normalizedStem(value) {
  const stem = safeFileStem(value);
  if (!stem) throw new Error('Document name is required.');
  return stem.replace(/\.(hvy|thvy|md)$/i, '');
}

function safeFileStem(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+$/, 'Untitled')
    || 'Untitled';
}

function workspaceRootForDocument(directory) {
  let current = directory;
  while (current && current !== path.dirname(current)) {
    if (workspaceManifestPath(current)) return current;
    current = path.dirname(current);
  }
  return null;
}

function addRecentWorkspace(entryPath) {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  recent.workspaces = pushRecent(recent.workspaces || [], entryPath);
  writeJson(dataPath(RECENT_STATE), recent);
  refreshMenu();
}

function removeRecentWorkspace(entryPath) {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  const normalized = path.resolve(entryPath);
  recent.workspaces = (recent.workspaces || []).filter((entry) => path.resolve(entry) !== normalized);
  writeJson(dataPath(RECENT_STATE), recent);
  refreshMenu();
}

function addArchivedWorkspace(entry) {
  const archived = loadArchivedWorkspaces();
  const normalized = path.resolve(entry.path);
  const next = [
    { ...entry, path: normalized },
    ...archived.filter((item) => path.resolve(item.path) !== normalized),
  ];
  writeJson(dataPath(ARCHIVED_WORKSPACES), next);
}

function removeArchivedWorkspace(entryPath) {
  const archived = loadArchivedWorkspaces();
  const normalized = path.resolve(entryPath);
  const next = archived.filter((entry) => path.resolve(entry.path) !== normalized);
  writeJson(dataPath(ARCHIVED_WORKSPACES), next);
}

function addRecentFile(entryPath) {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  recent.files = pushRecent(recent.files || [], entryPath);
  writeJson(dataPath(RECENT_STATE), recent);
  refreshMenu();
}

function removeRecentFile(entryPath) {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  const normalized = path.resolve(entryPath);
  recent.files = (recent.files || []).filter((entry) => path.resolve(entry) !== normalized);
  writeJson(dataPath(RECENT_STATE), recent);
  refreshMenu();
}

function pushRecent(entries, entryPath) {
  const normalized = path.resolve(entryPath);
  return [normalized, ...entries.filter((entry) => path.resolve(entry) !== normalized)].slice(0, RECENT_LIMIT);
}

function menuLabel(entryPath) {
  return path.basename(entryPath) || entryPath;
}

function defaultAiSettings() {
  return {
    activeProviderId: 'openai',
    providers: [{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' }],
    actions: {
      chat: { providerId: 'openai', model: 'gpt-5.4-nano', modelsByProvider: { openai: 'gpt-5.4-nano' } },
      edit: { providerId: 'openai', model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
      importPlanning: { providerId: 'openai', model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
      importWriting: { providerId: 'openai', model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
      importCleanup: { providerId: 'openai', model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
      semanticFilter: { providerId: 'openai', model: 'gpt-5.4-nano', modelsByProvider: { openai: 'gpt-5.4-nano' } },
      compaction: { providerId: 'openai', model: 'gpt-5.4-nano', modelsByProvider: { openai: 'gpt-5.4-nano' } },
    },
    maxContextChars: DEFAULT_AI_MAX_CONTEXT_CHARS,
  };
}

function normalizeAiSettings(settings) {
  return {
    ...defaultAiSettings(),
    ...(settings || {}),
    maxContextChars: normalizeAiMaxContextChars(settings?.maxContextChars),
  };
}

function normalizeAiMaxContextChars(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_MAX_CONTEXT_CHARS;
  const stepped = Math.round(parsed / AI_CONTEXT_STEP_CHARS) * AI_CONTEXT_STEP_CHARS;
  return Math.min(AI_MAX_CONTEXT_CHARS, Math.max(AI_MIN_CONTEXT_CHARS, stepped));
}

function defaultMcpSettings() {
  return {
    startAutomatically: false,
    port: 8794,
    writeAccess: 'hvyCliEdits',
    bearerToken: crypto.randomBytes(32).toString('base64url'),
  };
}

function normalizeMcpSettings(settings) {
  return {
    ...defaultMcpSettings(),
    ...(settings || {}),
  };
}

function defaultMcpStdioLaunchConfig() {
  return {
    command: mcpCommandPath(),
    args: ['--mcp-stdio'],
    workingDirectory: path.join(sharedAppDataDir(), 'mcp'),
  };
}

function mcpCommandPath() {
  if (process.env.HVY_GALAXY_MCP_COMMAND) {
    return process.env.HVY_GALAXY_MCP_COMMAND;
  }
  const devRustLauncher = path.resolve('src-tauri', 'target', 'debug', process.platform === 'win32' ? 'hvy-galaxy.exe' : 'hvy-galaxy');
  if (fs.existsSync(devRustLauncher)) {
    return devRustLauncher;
  }
  return process.execPath;
}

function mcpClientInstallStatuses() {
  const launch = defaultMcpStdioLaunchConfig();
  return [
    mcpClientInstallStatus('codex', 'Codex', codexConfigPath(), launch, codexConfigHasHvyMcp),
    mcpClientInstallStatus('claude', 'Claude', claudeConfigPath(), launch, claudeConfigHasHvyMcp),
  ];
}

function installMcpClient(target) {
  const launch = defaultMcpStdioLaunchConfig();
  const configPath = mcpTargetConfigPath(target);
  if (!fs.existsSync(configPath) && !(target === 'claude' && claudeConfigCanBeCreated(configPath))) {
    throw new Error(`${configPath} was not found.`);
  }
  if (target === 'codex') {
    const current = fs.readFileSync(configPath, 'utf8');
    backupFileBeforeOverwrite(configPath);
    writeText(configPath, upsertCodexMcpBlock(current, launch));
  } else if (target === 'claude') {
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}\n';
    if (fs.existsSync(configPath)) {
      backupFileBeforeOverwrite(configPath);
    }
    writeText(configPath, upsertClaudeMcpConfig(current, launch));
  } else {
    throw new Error(`Unknown MCP client target: ${target}`);
  }
  return mcpClientInstallStatuses();
}

function removeMcpClient(target) {
  const configPath = mcpTargetConfigPath(target);
  if (!fs.existsSync(configPath)) {
    throw new Error(`${configPath} was not found.`);
  }
  if (target === 'codex') {
    const current = fs.readFileSync(configPath, 'utf8');
    backupFileBeforeOverwrite(configPath);
    writeText(configPath, removeCodexMcpBlock(current));
  } else if (target === 'claude') {
    const current = fs.readFileSync(configPath, 'utf8');
    backupFileBeforeOverwrite(configPath);
    writeText(configPath, removeClaudeMcpConfig(current));
  } else {
    throw new Error(`Unknown MCP client target: ${target}`);
  }
  return mcpClientInstallStatuses();
}

function restoreMcpClientBackup(target) {
  const configPath = mcpTargetConfigPath(target);
  const backupPath = latestMcpClientBackupPath(configPath);
  if (!backupPath) {
    throw new Error(`No HVY MCP backup was found for ${configPath}.`);
  }
  if (fs.existsSync(configPath)) {
    backupFileBeforeOverwrite(configPath);
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }
  fs.copyFileSync(backupPath, configPath);
  return mcpClientInstallStatuses();
}

function mcpClientInstallStatus(target, label, configPath, launch, isInstalled) {
  const configExists = fs.existsSync(configPath) || (target === 'claude' && claudeConfigCanBeCreated(configPath));
  const executableExists = fs.existsSync(launch.command);
  const installed = configExists && isInstalled(configPath, launch);
  const backups = mcpClientBackupPaths(configPath);
  const latestBackupPath = backups[0] || null;
  const latestBackupLabel = latestBackupPath ? mcpClientBackupLabel(path.basename(latestBackupPath)) : null;
  let message;
  if (!configExists) {
    message = backups.length
      ? `${label} config file was not found. A backup can be restored.`
      : `${label} config file was not found.`;
  } else if (installed) {
    message = executableExists
      ? `HVY MCP is installed for ${label}. Refresh or remove it anytime.`
      : 'HVY MCP is installed, but the HVY Galaxy executable was not found.';
  } else if (!executableExists) {
    message = 'HVY Galaxy executable was not found.';
  } else {
    message = `Ready to install HVY MCP for ${label}. A backup will be saved first.`;
  }
  return {
    target,
    label,
    configPath,
    configExists,
    executableExists,
    installed,
    backupCount: backups.length,
    latestBackupPath,
    latestBackupLabel,
    message,
  };
}

function mcpTargetConfigPath(target) {
  if (target === 'codex') return codexConfigPath();
  if (target === 'claude') return claudeConfigPath();
  throw new Error(`Unknown MCP client target: ${target}`);
}

function codexConfigPath() {
  if (process.env.CODEX_HOME) {
    return path.join(process.env.CODEX_HOME, 'config.toml');
  }
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function claudeConfigPath() {
  if (process.platform === 'win32') {
    const packagedConfigDir = packagedClaudeConfigDir();
    if (packagedConfigDir) {
      return path.join(packagedConfigDir, 'claude_desktop_config.json');
    }
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

function claudeConfigCanBeCreated(configPath) {
  if (fs.existsSync(path.dirname(configPath))) {
    return true;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return Boolean(packagedClaudeConfigDir()) || fs.existsSync(path.join(localAppData, 'Claude'));
  }
  return false;
}

function packagedClaudeConfigDir() {
  if (process.platform !== 'win32') {
    return null;
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const packagesDir = path.join(localAppData, 'Packages');
  if (!fs.existsSync(packagesDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('Claude_')) {
      continue;
    }
    const configDir = path.join(packagesDir, entry.name, 'LocalCache', 'Roaming', 'Claude');
    if (fs.existsSync(configDir)) {
      return configDir;
    }
  }
  return null;
}

function codexConfigHasHvyMcp(configPath, launch) {
  if (!fs.existsSync(configPath)) return false;
  const content = fs.readFileSync(configPath, 'utf8');
  return (
    (content.includes('[mcp_servers.hvy-galaxy]') || content.includes('[mcp_servers."hvy-galaxy"]')) &&
    content.includes(tomlString(launch.command))
  );
}

function claudeConfigHasHvyMcp(configPath, launch) {
  if (!fs.existsSync(configPath)) return false;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.mcpServers?.['hvy-galaxy']?.command === launch.command;
  } catch {
    return false;
  }
}

function upsertCodexMcpBlock(content, launch) {
  const next = removeCodexMcpBlock(content).trimEnd();
  return `${next ? `${next}\n\n` : ''}${codexMcpBlock(launch)}\n`;
}

function removeCodexMcpBlock(content) {
  const output = [];
  let skipping = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const isHvyHeader = trimmed === '[mcp_servers.hvy-galaxy]' || trimmed === '[mcp_servers."hvy-galaxy"]';
    if (isHvyHeader) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith('[')) {
      skipping = false;
    }
    if (!skipping) {
      output.push(line);
    }
  }
  return `${output.join('\n').trimEnd()}\n`;
}

function codexMcpBlock(launch) {
  return [
    '[mcp_servers.hvy-galaxy]',
    'type = "stdio"',
    `command = ${tomlString(launch.command)}`,
    `args = ${tomlStringArray(launch.args)}`,
    `cwd = ${tomlString(launch.workingDirectory)}`,
  ].join('\n');
}

function upsertClaudeMcpConfig(content, launch) {
  const config = content.trim() ? JSON.parse(content) : {};
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Claude config must be a JSON object.');
  }
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? config.mcpServers
    : {};
  servers['hvy-galaxy'] = {
    type: 'stdio',
    command: launch.command,
    args: launch.args,
    cwd: launch.workingDirectory,
  };
  config.mcpServers = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function removeClaudeMcpConfig(content) {
  const config = content.trim() ? JSON.parse(content) : {};
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Claude config must be a JSON object.');
  }
  if (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
    delete config.mcpServers['hvy-galaxy'];
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

function backupFileBeforeOverwrite(filePath) {
  const directory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? '' : `-${index}`;
    const backupPath = path.join(directory, `${fileName}.hvy-galaxy-backup-${timestamp}${suffix}`);
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
      return backupPath;
    }
  }
  throw new Error(`Could not create a backup for ${filePath}.`);
}

function latestMcpClientBackupPath(filePath) {
  return mcpClientBackupPaths(filePath)[0] || null;
}

function mcpClientBackupPaths(filePath) {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.hvy-galaxy-backup-`;
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .reverse()
    .map((name) => path.join(directory, name));
}

function mcpClientBackupLabel(fileName) {
  return fileName.split('.hvy-galaxy-backup-')[1] || fileName;
}

function tomlStringArray(values) {
  return `[${values.map((value) => tomlString(value)).join(', ')}]`;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}
