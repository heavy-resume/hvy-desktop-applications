const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WORKSPACE_MANIFEST = '.hvyworkspace.json';
const LEGACY_WORKSPACE_MANIFEST = '.hvygalaxy.json';
const RECENT_STATE = 'recent.json';
const AI_SETTINGS = 'ai-settings.json';
const MCP_SETTINGS = 'mcp-settings.json';
const COMPATIBILITY_SETTINGS = 'compatibility-settings.json';
const RECENT_LIMIT = 12;
const DOCUMENT_EXTENSIONS = new Set(['.hvy', '.thvy', '.md']);
const TEMPLATE_EXTENSIONS = new Set(['.hvy', '.thvy']);
const THEME_EXTENSIONS = new Set(['.hvytheme', '.json']);
const APP_IDENTIFIER = 'com.heavyresume.hvy-galaxy';
const APP_NAME = 'HVY Galaxy';

let mainWindow = null;
let mcpStatus = {
  running: false,
  url: null,
  message: 'MCP server is Tauri-only in this Electron build.',
  lastError: null,
};

app.setName(APP_NAME);
app.setAppUserModelId(APP_IDENTIFIER);
app.setPath('userData', electronProfileDir());

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath('icon.png'));
  }
  mainWindow = createWindow();
  buildMenu();
  await loadRenderer(mainWindow);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
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

function createWindow() {
  return new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#f7f3ea',
    icon: iconPath(process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
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
  const compatibility = readJson(dataPath(COMPATIBILITY_SETTINGS), { forced: false });
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        menuItem('New Workspace', 'new-workspace', 'CmdOrCtrl+Shift+N'),
        menuItem('Open Workspace...', 'open-workspace', 'CmdOrCtrl+O'),
        menuItem('Open File...', 'open-file', 'CmdOrCtrl+Shift+O'),
        recentSubmenu('Open Recent Workspace', recent.workspaces, 'recent-workspace:'),
        recentSubmenu('Open Recent File', recent.files, 'recent-file:'),
        { type: 'separator' },
        menuItem('Save', 'save', 'CmdOrCtrl+S'),
        menuItem('Save As...', 'save-as', 'CmdOrCtrl+Shift+S'),
        menuItem('Import Into Current...', 'import-current'),
        menuItem('Export Document...', 'export-document'),
        { type: 'separator' },
        menuItem('Recover Backup...', 'recover-backup'),
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
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
      label: 'Help',
      submenu: [
        menuItem('Open Guide', 'open-guide'),
        menuItem('AI Settings...', 'ai-settings'),
        menuItem('MCP Settings...', 'mcp-settings'),
        menuItem('Color Theme...', 'colors'),
        { type: 'separator' },
        {
          label: 'Compatibility Mode',
          type: 'checkbox',
          checked: Boolean(compatibility.forced),
          click() {
            const next = !readJson(dataPath(COMPATIBILITY_SETTINGS), { forced: false }).forced;
            writeJson(dataPath(COMPATIBILITY_SETTINGS), { forced: next });
            buildMenu();
            emitMenu(`compatibility-mode:${next}`);
          },
        },
        { type: 'separator' },
        menuItem('About HVY Galaxy', 'about'),
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
    click: () => emitMenu(id),
  };
}

function recentSubmenu(label, entries, prefix) {
  const submenu = entries.length
    ? entries.map((entry) => menuItem(menuLabel(entry), `${prefix}${entry}`))
    : [{ label: 'No Recent Items', enabled: false }];
  return { label, submenu };
}

function emitMenu(payload) {
  mainWindow?.webContents.send('hvy:menu-event', payload);
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
    case 'load_app_environment': return loadAppEnvironment();
    case 'load_recent_state': return readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
    case 'load_ai_settings': return readJson(dataPath(AI_SETTINGS), defaultAiSettings());
    case 'save_ai_settings': return writeJson(dataPath(AI_SETTINGS), normalizeAiSettings(args.settings));
    case 'load_mcp_settings': return readJson(dataPath(MCP_SETTINGS), defaultMcpSettings());
    case 'save_mcp_settings': return writeJson(dataPath(MCP_SETTINGS), normalizeMcpSettings(args.settings));
    case 'load_mcp_server_status': return mcpStatus;
    case 'load_mcp_stdio_launch_config': return defaultMcpStdioLaunchConfig();
    case 'load_mcp_client_install_status': return defaultMcpClientInstallStatus();
    case 'install_mcp_client': return defaultMcpClientInstallStatus();
    case 'remove_mcp_client': return defaultMcpClientInstallStatus();
    case 'restore_mcp_client_backup': return defaultMcpClientInstallStatus();
    case 'start_mcp_server':
      mcpStatus = { running: false, url: null, message: 'MCP server is Tauri-only in this Electron build.', lastError: null };
      return mcpStatus;
    case 'stop_mcp_server':
      mcpStatus = { running: false, url: null, message: 'MCP server is stopped.', lastError: null };
      return mcpStatus;
    case 'update_mcp_workspaces': return null;
    case 'load_default_guide': return readDocumentAt(defaultGuidePath());
    case 'open_workspace_dialog': return openWorkspaceDialog();
    case 'choose_workspace_folder': return chooseWorkspaceFolder();
    case 'create_workspace': return createWorkspace(args.name);
    case 'new_workspace_dialog': return newWorkspaceDialog();
    case 'initialize_workspace_path': return initializeWorkspacePath(args.path);
    case 'load_workspace': return loadWorkspace(args.path);
    case 'add_files_to_workspace': return addFilesToWorkspace(args.workspacePath);
    case 'open_file_dialog': return openFileDialog();
    case 'open_import_source_dialog': return openImportSourceDialog();
    case 'read_document_file': return readDocumentFile(args.path);
    case 'save_document_file': return saveDocumentFile(args.path, args.bytes);
    case 'save_document_as_dialog': return saveDocumentAsDialog(args.suggestedName, args.bytes);
    case 'list_saved_templates': return listSavedTemplates(args.workspacePath);
    case 'save_document_template': return saveDocumentTemplate(args.request);
    case 'open_color_theme_dialog': return openColorThemeDialog();
    case 'save_color_theme_as_dialog': return saveColorThemeAsDialog(args.suggestedName, args.bytes);
    case 'create_document_file': return createDocumentFile(args.workspacePath, args.relativePath, args.template);
    case 'reveal_document_file': return revealDocumentFile(args.path);
    case 'rename_document_file': return renameDocumentFile(args.path, args.name);
    case 'create_document_backup': return createDocumentBackup(args.request);
    case 'list_document_backups': return listDocumentBackups();
    case 'restore_document_backup': return restoreDocumentBackup(args.id);
    case 'open_external_url': return openExternalUrl(args.url);
    default: throw new Error(`Unknown Electron command: ${command}`);
  }
}

function dataPath(fileName) {
  return path.join(sharedAppDataDir(), fileName);
}

function appTemplatesDir() {
  return path.join(sharedAppDataDir(), 'templates');
}

function workspaceTemplatesDir(workspacePath) {
  return path.join(workspacePath, '.hvy-templates');
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

function loadAppEnvironment() {
  const version = macosVersion();
  const forced = Boolean(readJson(dataPath(COMPATIBILITY_SETTINGS), { forced: false }).forced);
  return {
    platform: process.platform,
    arch: process.arch,
    macosMajor: version?.major ?? null,
    macosMinor: version?.minor ?? null,
    macosPatch: version?.patch ?? null,
    legacyWebview: false,
    forcedCompatibilityMode: forced,
    compatibilityMode: forced,
  };
}

function macosVersion() {
  if (process.platform !== 'darwin') return null;
  try {
    const value = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
    const [major, minor = '0', patch = '0'] = value.split('.').map((part) => Number.parseInt(part, 10));
    return { major, minor, patch };
  } catch {
    return null;
  }
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

function loadWorkspace(selectedPath) {
  const workspace = ensureWorkspace(selectedPath);
  addRecentWorkspace(selectedPath);
  return workspace;
}

async function addFilesToWorkspace(workspacePath) {
  ensureWorkspace(workspacePath);
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported documents', extensions: ['hvy', 'thvy', 'md'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  for (const source of result.filePaths) {
    if (!documentExtension(source)) throw new Error('Only .hvy, .thvy, and .md documents can be added to a workspace.');
    const destination = uniqueCopyPath(workspacePath, path.basename(source));
    fs.copyFileSync(source, destination);
    addRecentFile(destination);
  }
  touchWorkspaceManifest(workspacePath);
  addRecentWorkspace(workspacePath);
  return loadWorkspaceFromPath(workspacePath);
}

async function openFileDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Supported documents', extensions: ['hvy', 'thvy', 'md'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy'] },
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
      { name: 'Text import sources', extensions: ['txt', 'md'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Plain text', extensions: ['txt'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0];
  const extension = path.extname(selected).toLowerCase();
  if (!['.txt', '.md'].includes(extension)) throw new Error('Only .txt and .md files can be imported.');
  return {
    path: selected,
    name: path.basename(selected),
    text: fs.readFileSync(selected, 'utf8'),
  };
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
      { name: 'Supported documents', extensions: ['hvy', 'thvy', 'md'] },
      { name: 'HVY documents', extensions: ['hvy', 'thvy'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  if (!documentExtension(result.filePath)) throw new Error('Save As path must end in .hvy, .thvy, or .md.');
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
  const fileName = ensureTemplateFileName(request.name);
  const filePath = path.join(directory, fileName);
  writeBytes(filePath, request.bytes);
  return readSavedTemplateAt(filePath, request.scope);
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

function renameDocumentFile(filePath, name) {
  const extension = documentExtension(filePath);
  if (!extension) throw new Error('Only .hvy, .thvy, and .md documents can be renamed.');
  const parent = path.dirname(filePath);
  const stem = normalizedStem(name);
  const destination = path.join(parent, `${stem}${extension}`);
  if (destination === filePath) return readDocumentAt(filePath);
  if (fs.existsSync(destination)) throw new Error('A document with that name already exists.');
  fs.renameSync(filePath, destination);
  const workspacePath = workspaceRootForDocument(parent);
  if (workspacePath) touchWorkspaceManifest(workspacePath);
  addRecentFile(destination);
  return readDocumentAt(destination);
}

function createDocumentBackup(request) {
  if (!documentExtension(request.name)) throw new Error('Backup document name must end in .hvy, .thvy, or .md.');
  fs.mkdirSync(backupsDir(), { recursive: true });
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
  if (!fs.existsSync(backupsDir())) return [];
  return fs.readdirSync(backupsDir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(backupsDir(), name), null))
    .filter(Boolean)
    .map((snapshot) => ({
      id: snapshot.id,
      documentPath: snapshot.documentPath,
      name: snapshot.name,
      extension: snapshot.extension,
      createdAt: snapshot.createdAt,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function restoreDocumentBackup(id) {
  const snapshot = readJson(path.join(backupsDir(), `${id}.json`), null);
  if (!snapshot) throw new Error('Backup was not found.');
  return {
    path: snapshot.documentPath,
    name: snapshot.name,
    extension: snapshot.extension,
    bytes: snapshot.bytes,
  };
}

async function openExternalUrl(url) {
  await shell.openExternal(url);
  return null;
}

function ensureWorkspace(workspacePath) {
  return workspaceManifestPath(workspacePath) ? loadWorkspaceFromPath(workspacePath) : initializeWorkspaceWithName(workspacePath, null);
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
  };
  writeJson(manifestPath, manifest);
  return loadWorkspaceFromPath(workspacePath);
}

function loadWorkspaceFromPath(workspacePath) {
  const manifestPath = workspaceManifestPath(workspacePath);
  if (!manifestPath) throw new Error('Workspace manifest was not found.');
  return {
    path: workspacePath,
    manifest: readJson(manifestPath, null),
    files: readWorkspaceChildren(workspacePath, workspacePath),
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

function readWorkspaceChildren(root, directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return {
          kind: 'folder',
          name: entry.name,
          path: entryPath,
          relativePath: path.relative(root, entryPath),
          children: readWorkspaceChildren(root, entryPath),
        };
      }
      const extension = documentExtension(entryPath);
      if (!extension) return null;
      return {
        kind: 'file',
        name: entry.name,
        path: entryPath,
        relativePath: path.relative(root, entryPath),
        extension,
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
  if (!extension) throw new Error('Only .hvy, .thvy, and .md documents can be opened.');
  return {
    path: filePath,
    name: path.basename(filePath),
    extension,
    bytes: Array.from(fs.readFileSync(filePath)),
  };
}

function readTemplatesFrom(directory, scope) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => TEMPLATE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => readSavedTemplateAt(path.join(directory, name), scope));
}

function readSavedTemplateAt(filePath, scope) {
  return {
    id: `${scope}:${filePath}`,
    path: filePath,
    name: path.basename(filePath, path.extname(filePath)),
    scope,
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

function ensureTemplateFileName(name) {
  const base = safeFileStem(name || 'Template');
  const extension = path.extname(base).toLowerCase();
  return TEMPLATE_EXTENSIONS.has(extension) ? base : `${base}.thvy`;
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
  buildMenu();
}

function addRecentFile(entryPath) {
  const recent = readJson(dataPath(RECENT_STATE), { workspaces: [], files: [] });
  recent.files = pushRecent(recent.files || [], entryPath);
  writeJson(dataPath(RECENT_STATE), recent);
  buildMenu();
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
      chat: { providerId: 'openai', model: 'gpt-5.4-nano' },
      edit: { providerId: 'openai', model: 'gpt-5.4-mini' },
      importPlanning: { providerId: 'openai', model: 'gpt-5.4-mini' },
      importWriting: { providerId: 'openai', model: 'gpt-5.4-mini' },
      importCleanup: { providerId: 'openai', model: 'gpt-5.4-mini' },
      semanticFilter: { providerId: 'openai', model: 'gpt-5.4-nano' },
      compaction: { providerId: 'openai', model: 'gpt-5.4-nano' },
    },
  };
}

function normalizeAiSettings(settings) {
  return settings || defaultAiSettings();
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
    command: process.execPath,
    args: ['--mcp-stdio'],
    workingDirectory: path.join(sharedAppDataDir(), 'mcp'),
  };
}

function defaultMcpClientInstallStatus() {
  return [
    {
      target: 'codex',
      label: 'Codex',
      configPath: path.join(os.homedir(), '.codex', 'config.toml'),
      configExists: false,
      executableExists: false,
      installed: false,
      backupCount: 0,
      latestBackupPath: null,
      latestBackupLabel: null,
      message: 'MCP install is Tauri-only in this Electron build.',
    },
    {
      target: 'claude',
      label: 'Claude',
      configPath: path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      configExists: false,
      executableExists: false,
      installed: false,
      backupCount: 0,
      latestBackupPath: null,
      latestBackupLabel: null,
      message: 'MCP install is Tauri-only in this Electron build.',
    },
  ];
}
