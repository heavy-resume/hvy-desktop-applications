import './styles.css';

import {
  createPluginProject,
  listPluginProjects,
  loadRecentState,
  loadWorkspace,
  readPluginProjectFiles,
  writePluginProjectBuild,
  writePluginProjectFile,
  type Workspace,
} from '../backend';
import {
  buildPluginProjectPackage,
  createPluginProjectScaffold,
  pluginProjectStarterLabel,
  validatePluginProjectFiles,
  type PluginProjectDiagnostic,
  type PluginProjectRecord,
  type PluginProjectScaffold,
  type PluginProjectStarter,
  type PluginProjectFile,
} from '../pluginProjects';

interface BuilderWorkspace {
  path: string;
  name: string;
}

interface PendingNavigation {
  kind: 'workspace' | 'project';
  value: string;
}

interface PluginBuilderState {
  workspaces: BuilderWorkspace[];
  selectedWorkspacePath: string;
  projects: PluginProjectRecord[];
  selectedProjectDirectory: string;
  projectFiles: PluginProjectFile[];
  fileDrafts: Record<string, string>;
  selectedFilePath: string;
  diagnostics: PluginProjectDiagnostic[];
  lastBuildPath: string;
  createModalOpen: boolean;
  discardModalOpen: boolean;
  pendingNavigation: PendingNavigation | null;
  busy: boolean;
  error: string;
  status: string;
}

const state: PluginBuilderState = {
  workspaces: [],
  selectedWorkspacePath: '',
  projects: [],
  selectedProjectDirectory: '',
  projectFiles: [],
  fileDrafts: {},
  selectedFilePath: '',
  diagnostics: [],
  lastBuildPath: '',
  createModalOpen: false,
  discardModalOpen: false,
  pendingNavigation: null,
  busy: false,
  error: '',
  status: 'Loading workspaces...',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function selectedWorkspace(): BuilderWorkspace | null {
  return state.workspaces.find((workspace) => workspace.path === state.selectedWorkspacePath) ?? null;
}

function selectedProject(): PluginProjectRecord | null {
  return state.projects.find((project) => project.directoryName === state.selectedProjectDirectory) ?? null;
}

function projectRuntime(project: PluginProjectRecord): string {
  const entry = project.manifest?.entry.toLowerCase() ?? '';
  return entry.endsWith('.py') ? 'Python' : entry.endsWith('.js') || entry.endsWith('.mjs') ? 'JavaScript' : 'Unknown runtime';
}

function selectedSourceFile(): PluginProjectFile | null {
  return state.projectFiles.find((file) => file.path === state.selectedFilePath) ?? null;
}

function fileIsDirty(path: string): boolean {
  const file = state.projectFiles.find((candidate) => candidate.path === path);
  return Boolean(file && typeof file.content === 'string' && state.fileDrafts[path] !== file.content);
}

function hasDirtyFiles(): boolean {
  return state.projectFiles.some((file) => fileIsDirty(file.path));
}

function effectiveProjectFiles() {
  return state.projectFiles.map((file) => ({
    path: file.path,
    content: file.content === null ? null : state.fileDrafts[file.path] ?? file.content,
    bytes: file.bytes,
  }));
}

function renderCreateModal(): string {
  if (!state.createModalOpen) return '';
  return `
    <div class="plugin-builder-modal-backdrop" role="presentation">
      <form class="plugin-builder-modal" data-form="create-plugin" role="dialog" aria-modal="true" aria-labelledby="createPluginTitle">
        <h2 class="plugin-builder-heading-reset" id="createPluginTitle">New Plugin</h2>
        <p class="plugin-builder-modal-copy">Create a package-format plugin project in this workspace.</p>
        <label class="plugin-builder-field">
          <span>Name</span>
          <input class="plugin-builder-input" name="name" required maxlength="100" autocomplete="off" autofocus>
        </label>
        <label class="plugin-builder-field">
          <span>Starter</span>
          <select class="plugin-builder-select" name="starter">
            <option value="javascript-component">JavaScript Component</option>
            <option value="python-component">Python Component</option>
          </select>
        </label>
        <div class="plugin-builder-create-preview" data-role="create-preview">
          Enter a name to preview the project location.
        </div>
        <div class="plugin-builder-modal-actions">
          <button class="plugin-builder-button plugin-builder-button--ghost" type="button" data-action="cancel-create">Cancel</button>
          <button class="plugin-builder-button" type="submit" ${state.busy ? 'disabled' : ''}>Create Plugin</button>
        </div>
      </form>
    </div>`;
}

function renderDiscardModal(): string {
  if (!state.discardModalOpen) return '';
  const dirtyCount = state.projectFiles.filter((file) => fileIsDirty(file.path)).length;
  return `
    <div class="plugin-builder-modal-backdrop" role="presentation">
      <section class="plugin-builder-modal" role="dialog" aria-modal="true" aria-labelledby="discardChangesTitle">
        <h2 class="plugin-builder-heading-reset" id="discardChangesTitle">Discard unsaved changes?</h2>
        <p class="plugin-builder-modal-copy">${dirtyCount === 1 ? 'One file has' : `${dirtyCount} files have`} changes that have not been saved.</p>
        <div class="plugin-builder-modal-actions">
          <button class="plugin-builder-button plugin-builder-button--ghost" type="button" data-action="keep-editing">Keep Editing</button>
          <button class="plugin-builder-button plugin-builder-button--danger" type="button" data-action="discard-changes">Discard Changes</button>
        </div>
      </section>
    </div>`;
}

function renderProjectDetail(project: PluginProjectRecord | null): string {
  if (!project) {
    return `
      <section class="plugin-builder-empty">
        <h2 class="plugin-builder-empty-title">${state.selectedWorkspacePath ? 'Build a workspace plugin' : 'Select a workspace'}</h2>
        <p class="plugin-builder-empty-copy">${state.selectedWorkspacePath
    ? 'Create a JavaScript or Python component plugin, then edit and build it here.'
    : 'Plugin projects are stored in a plugins directory under an HVY workspace.'}</p>
        ${state.selectedWorkspacePath ? '<button class="plugin-builder-button" type="button" data-action="open-create">Create Plugin</button>' : ''}
      </section>`;
  }
  if (!project.manifest) {
    return `
      <section class="plugin-builder-project">
        <div class="plugin-builder-project-heading">
          <div><span class="plugin-builder-eyebrow">Invalid project</span><h2 class="plugin-builder-project-title">${escapeHtml(project.directoryName)}</h2></div>
          <span class="plugin-builder-badge plugin-builder-badge--error">Invalid</span>
        </div>
        <p class="plugin-builder-error-panel">${escapeHtml(project.error ?? 'The manifest could not be read.')}</p>
        <p class="plugin-builder-path">${escapeHtml(project.path)}</p>
      </section>`;
  }
  const manifest = project.manifest;
  const sourceFile = selectedSourceFile();
  return `
    <section class="plugin-builder-project">
      <div class="plugin-builder-project-heading">
        <div>
          <span class="plugin-builder-eyebrow">${escapeHtml(projectRuntime(project))} component</span>
          <h2 class="plugin-builder-project-title">${escapeHtml(manifest.displayName)}</h2>
        </div>
        <span class="plugin-builder-badge">Source</span>
      </div>
      <div class="plugin-builder-section-heading">
        <div><h3 class="plugin-builder-section-title">Project files</h3><p class="plugin-builder-section-copy">The source directory mirrors the package archive.</p></div>
        <div class="plugin-builder-project-actions">
          <button class="plugin-builder-button plugin-builder-button--ghost" type="button" data-action="validate-project" ${state.busy ? 'disabled' : ''}>Validate</button>
          <button class="plugin-builder-button" type="button" data-action="build-project" ${state.busy ? 'disabled' : ''}>Build</button>
        </div>
      </div>
      <div class="plugin-builder-workbench">
        <div class="plugin-builder-file-list">
          ${state.projectFiles.map((file, index, files) => `
            <button class="plugin-builder-file-item${index === files.length - 1 ? ' plugin-builder-file-item--last' : ''}${file.path === state.selectedFilePath ? ' is-selected' : ''}" type="button" data-file="${escapeHtml(file.path)}">
              <span>${escapeHtml(file.path)}</span>${fileIsDirty(file.path) ? '<span class="plugin-builder-dirty-mark" aria-label="Modified">●</span>' : ''}
            </button>`).join('')}
        </div>
        <div class="plugin-builder-editor-panel">
          ${sourceFile && sourceFile.content !== null ? `
            <div class="plugin-builder-editor-heading">
              <strong>${escapeHtml(sourceFile.path)}</strong>
              <button class="plugin-builder-button plugin-builder-button--ghost" type="button" data-action="save-source" ${!fileIsDirty(sourceFile.path) || state.busy ? 'disabled' : ''}>Save</button>
            </div>
            <textarea class="plugin-builder-source-editor" data-field="source" spellcheck="false" aria-label="${escapeHtml(sourceFile.path)} source">${escapeHtml(state.fileDrafts[sourceFile.path] ?? sourceFile.content)}</textarea>
          ` : `<div class="plugin-builder-editor-empty">${sourceFile ? 'Binary asset preview is not available.' : 'Select a project file.'}</div>`}
        </div>
      </div>
      <p class="plugin-builder-path">${escapeHtml(project.path)}</p>
      ${state.diagnostics.length > 0 ? `
        <div class="plugin-builder-diagnostics" role="status">
          ${state.diagnostics.map((diagnostic) => `<button type="button" class="plugin-builder-diagnostic" data-file="${escapeHtml(diagnostic.path)}"><strong>${escapeHtml(diagnostic.path)}</strong><span>${escapeHtml(diagnostic.message)}</span></button>`).join('')}
        </div>` : ''}
      ${state.lastBuildPath ? `<div class="plugin-builder-build-result"><strong>Built package</strong><span>${escapeHtml(state.lastBuildPath)}</span></div>` : ''}
    </section>`;
}

function render(): void {
  const root = document.querySelector<HTMLElement>('#plugin-builder-app');
  if (!root) return;
  const project = selectedProject();
  root.innerHTML = `
    <main class="plugin-builder-shell">
      <header class="plugin-builder-header">
        <div><span class="plugin-builder-eyebrow">HVY Galaxy</span><h1 class="plugin-builder-title">Plugin Builder</h1></div>
        <label class="plugin-builder-workspace-control">
          <span>Workspace</span>
          <select class="plugin-builder-select" data-field="workspace" ${state.busy ? 'disabled' : ''}>
            ${state.workspaces.length === 0 ? '<option value="">No workspaces available</option>' : ''}
            ${state.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.path)}" ${workspace.path === state.selectedWorkspacePath ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>`).join('')}
          </select>
        </label>
      </header>
      <div class="plugin-builder-layout">
        <aside class="plugin-builder-sidebar">
          <div class="plugin-builder-sidebar-heading">
            <div class="plugin-builder-sidebar-title-row"><h2 class="plugin-builder-sidebar-title">Plugins</h2><span class="plugin-builder-project-count">${state.projects.length}</span></div>
            <button class="plugin-builder-icon-button" type="button" data-action="open-create" aria-label="Create plugin" title="Create plugin" ${!state.selectedWorkspacePath || state.busy ? 'disabled' : ''}>+</button>
          </div>
          <nav class="plugin-builder-project-list" aria-label="Plugin projects">
            ${state.projects.map((candidate) => `
              <button class="plugin-builder-project-row ${candidate.directoryName === project?.directoryName ? 'is-selected' : ''}" type="button" data-project="${escapeHtml(candidate.directoryName)}">
                <strong>${escapeHtml(candidate.manifest?.displayName ?? candidate.directoryName)}</strong>
                <span class="plugin-builder-project-runtime">${candidate.manifest ? escapeHtml(projectRuntime(candidate)) : 'Invalid manifest'}</span>
              </button>`).join('')}
            ${state.projects.length === 0 && state.selectedWorkspacePath ? '<p class="plugin-builder-sidebar-empty">No plugin projects yet.</p>' : ''}
          </nav>
        </aside>
        <div class="plugin-builder-content">
          ${state.error ? `<div class="plugin-builder-banner plugin-builder-banner--error" role="alert">${escapeHtml(state.error)}</div>` : ''}
          ${renderProjectDetail(project)}
        </div>
      </div>
      <footer class="plugin-builder-status"><span>${escapeHtml(state.status)}</span><span class="plugin-builder-status-path">${escapeHtml(selectedWorkspace()?.path ?? '')}</span></footer>
    </main>
    ${renderCreateModal()}
    ${renderDiscardModal()}`;
  root.querySelector<HTMLInputElement>('input[autofocus]')?.focus();
}

async function refreshProjects(preferredDirectory = ''): Promise<void> {
  if (!state.selectedWorkspacePath) {
    state.projects = [];
    state.selectedProjectDirectory = '';
    render();
    return;
  }
  state.busy = true;
  state.error = '';
  render();
  try {
    state.projects = await listPluginProjects(state.selectedWorkspacePath);
    const selection = preferredDirectory || state.selectedProjectDirectory;
    state.selectedProjectDirectory = state.projects.some((project) => project.directoryName === selection)
      ? selection
      : state.projects[0]?.directoryName ?? '';
    await loadSelectedProjectFiles();
    state.status = state.projects.length === 1 ? '1 plugin project' : `${state.projects.length} plugin projects`;
  } catch (error) {
    state.projects = [];
    state.selectedProjectDirectory = '';
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load plugin projects';
  } finally {
    state.busy = false;
    render();
  }
}

async function loadSelectedProjectFiles(): Promise<void> {
  if (!state.selectedWorkspacePath || !state.selectedProjectDirectory) {
    state.projectFiles = [];
    state.fileDrafts = {};
    state.selectedFilePath = '';
    state.diagnostics = [];
    state.lastBuildPath = '';
    return;
  }
  state.projectFiles = await readPluginProjectFiles(state.selectedWorkspacePath, state.selectedProjectDirectory);
  state.fileDrafts = Object.fromEntries(state.projectFiles
    .filter((file): file is PluginProjectFile & { content: string } => typeof file.content === 'string')
    .map((file) => [file.path, file.content]));
  state.selectedFilePath = state.projectFiles.some((file) => file.path === state.selectedFilePath)
    ? state.selectedFilePath
    : state.projectFiles.find((file) => file.path === 'hvy-plugin.json')?.path ?? state.projectFiles[0]?.path ?? '';
  state.diagnostics = [];
  state.lastBuildPath = '';
}

async function selectProject(directoryName: string): Promise<void> {
  state.selectedProjectDirectory = directoryName;
  state.busy = true;
  state.error = '';
  render();
  try {
    await loadSelectedProjectFiles();
    state.status = `Opened ${selectedProject()?.manifest?.displayName ?? directoryName}`;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load plugin project files';
  } finally {
    state.busy = false;
    render();
  }
}

async function applyNavigation(navigation: PendingNavigation): Promise<void> {
  state.discardModalOpen = false;
  state.pendingNavigation = null;
  if (navigation.kind === 'workspace') {
    state.selectedWorkspacePath = navigation.value;
    state.selectedProjectDirectory = '';
    await refreshProjects();
    return;
  }
  await selectProject(navigation.value);
}

function requestNavigation(navigation: PendingNavigation): void {
  const currentValue = navigation.kind === 'workspace'
    ? state.selectedWorkspacePath
    : state.selectedProjectDirectory;
  if (navigation.value === currentValue) return;
  if (hasDirtyFiles()) {
    state.pendingNavigation = navigation;
    state.discardModalOpen = true;
    render();
    return;
  }
  void applyNavigation(navigation);
}

async function saveSelectedSource(): Promise<void> {
  const project = selectedProject();
  const file = selectedSourceFile();
  if (!project || !file || file.content === null || !fileIsDirty(file.path)) return;
  state.busy = true;
  state.error = '';
  render();
  try {
    const content = state.fileDrafts[file.path] ?? file.content;
    await writePluginProjectFile({
      workspacePath: state.selectedWorkspacePath,
      directoryName: project.directoryName,
      path: file.path,
      content,
    });
    file.content = content;
    state.status = `Saved ${file.path}`;
    if (file.path === 'hvy-plugin.json') {
      const validation = validatePluginProjectFiles(effectiveProjectFiles());
      if (validation.manifest) project.manifest = validation.manifest;
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = `Could not save ${file.path}`;
  } finally {
    state.busy = false;
    render();
  }
}

function validateCurrentProject(): void {
  const validation = validatePluginProjectFiles(effectiveProjectFiles());
  state.diagnostics = validation.diagnostics;
  state.status = validation.diagnostics.length === 0
    ? `Validated ${validation.manifest?.displayName ?? 'plugin project'}`
    : `${validation.diagnostics.length} validation ${validation.diagnostics.length === 1 ? 'error' : 'errors'}`;
  render();
}

async function buildCurrentProject(): Promise<void> {
  const project = selectedProject();
  if (!project) return;
  state.busy = true;
  state.error = '';
  state.diagnostics = [];
  render();
  try {
    const built = buildPluginProjectPackage(effectiveProjectFiles());
    const result = await writePluginProjectBuild({
      workspacePath: state.selectedWorkspacePath,
      directoryName: project.directoryName,
      name: built.name,
      bytes: Array.from(built.bytes),
    });
    state.lastBuildPath = result.path;
    state.status = `Built ${result.name}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.diagnostics = validatePluginProjectFiles(effectiveProjectFiles()).diagnostics;
    state.error = message;
    state.status = 'Plugin build failed';
  } finally {
    state.busy = false;
    render();
  }
}

function previewScaffold(form: HTMLFormElement): PluginProjectScaffold | null {
  const workspace = selectedWorkspace();
  const data = new FormData(form);
  const name = String(data.get('name') ?? '');
  const starter = String(data.get('starter') ?? '') as PluginProjectStarter;
  if (!workspace || !name.trim() || !['javascript-component', 'python-component'].includes(starter)) return null;
  return createPluginProjectScaffold(name, starter, () => 'generated-when-created');
}

function updateCreatePreview(form: HTMLFormElement): void {
  const preview = form.querySelector<HTMLElement>('[data-role="create-preview"]');
  if (!preview) return;
  const scaffold = previewScaffold(form);
  preview.innerHTML = scaffold
    ? `<span>plugins/${escapeHtml(scaffold.directoryName)}</span>`
    : 'Enter a name to preview the project location.';
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action], [data-project], [data-file]') : null;
  if (!target) return;
  if (target.dataset.action === 'open-create' && state.selectedWorkspacePath) {
    state.createModalOpen = true;
    state.error = '';
    render();
  }
  if (target.dataset.action === 'cancel-create') {
    state.createModalOpen = false;
    render();
  }
  if (target.dataset.action === 'keep-editing') {
    state.discardModalOpen = false;
    state.pendingNavigation = null;
    render();
  }
  if (target.dataset.action === 'discard-changes' && state.pendingNavigation) {
    void applyNavigation(state.pendingNavigation);
  }
  if (target.dataset.project) {
    requestNavigation({ kind: 'project', value: target.dataset.project });
  }
  if (target.dataset.file && state.projectFiles.some((file) => file.path === target.dataset.file)) {
    state.selectedFilePath = target.dataset.file;
    render();
  }
  if (target.dataset.action === 'save-source') void saveSelectedSource();
  if (target.dataset.action === 'validate-project') validateCurrentProject();
  if (target.dataset.action === 'build-project') void buildCurrentProject();
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.field === 'workspace') {
    requestNavigation({ kind: 'workspace', value: target.value });
  }
  const form = target instanceof Element ? target.closest<HTMLFormElement>('form[data-form="create-plugin"]') : null;
  if (form) updateCreatePreview(form);
});

document.addEventListener('input', (event) => {
  const source = event.target instanceof HTMLTextAreaElement && event.target.dataset.field === 'source'
    ? event.target
    : null;
  if (source && state.selectedFilePath) {
    state.fileDrafts[state.selectedFilePath] = source.value;
    const save = document.querySelector<HTMLButtonElement>('[data-action="save-source"]');
    if (save) save.disabled = !fileIsDirty(state.selectedFilePath) || state.busy;
    const selectedFileButton = document.querySelector<HTMLElement>(`[data-file="${CSS.escape(state.selectedFilePath)}"]`);
    selectedFileButton?.classList.toggle('is-dirty', fileIsDirty(state.selectedFilePath));
  }
  const form = event.target instanceof Element ? event.target.closest<HTMLFormElement>('form[data-form="create-plugin"]') : null;
  if (form) updateCreatePreview(form);
});

document.addEventListener('submit', (event) => {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form || form.dataset.form !== 'create-plugin') return;
  event.preventDefault();
  const workspace = selectedWorkspace();
  const data = new FormData(form);
  const name = String(data.get('name') ?? '');
  const starter = String(data.get('starter') ?? '') as PluginProjectStarter;
  if (!workspace || !['javascript-component', 'python-component'].includes(starter)) return;
  state.busy = true;
  state.error = '';
  render();
  void (async () => {
    try {
      const scaffold = createPluginProjectScaffold(name, starter);
      await createPluginProject({
        workspacePath: workspace.path,
        directoryName: scaffold.directoryName,
        files: scaffold.files,
      });
      state.createModalOpen = false;
      state.status = `Created ${scaffold.manifest.displayName} from the ${pluginProjectStarterLabel(starter)} starter`;
      await refreshProjects(scaffold.directoryName);
    } catch (error) {
      state.busy = false;
      state.error = error instanceof Error ? error.message : String(error);
      state.status = 'Could not create plugin project';
      render();
    }
  })();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.discardModalOpen) {
    state.discardModalOpen = false;
    state.pendingNavigation = null;
    render();
    return;
  }
  if (event.key === 'Escape' && state.createModalOpen) {
    state.createModalOpen = false;
    render();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && selectedSourceFile()) {
    event.preventDefault();
    void saveSelectedSource();
  }
});

async function loadBuilderWorkspaces(): Promise<void> {
  try {
    const search = new URLSearchParams(location.search);
    let workspacePaths = search.getAll('workspace');
    if (workspacePaths.length === 0) {
      const encodedPaths = search.get('workspaces');
      if (encodedPaths) {
        try {
          const parsed = JSON.parse(encodedPaths) as unknown;
          workspacePaths = Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : [];
        } catch {
          workspacePaths = [];
        }
      }
    }
    if (workspacePaths.length === 0) workspacePaths = (await loadRecentState()).workspaces;
    const loaded = await Promise.all(workspacePaths.map(async (path): Promise<Workspace | null> => {
      try {
        return await loadWorkspace(path);
      } catch {
        return null;
      }
    }));
    state.workspaces = loaded
      .filter((workspace): workspace is Workspace => Boolean(workspace))
      .map((workspace) => ({ path: workspace.path, name: workspace.manifest.name }));
    const requestedWorkspace = search.get('selectedWorkspace') ?? '';
    state.selectedWorkspacePath = state.workspaces.some((workspace) => workspace.path === requestedWorkspace)
      ? requestedWorkspace
      : state.workspaces[0]?.path ?? '';
    state.status = state.workspaces.length === 0 ? 'No HVY workspaces are available' : 'Loading plugin projects...';
    await refreshProjects();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load workspaces';
    render();
  }
}

render();
void loadBuilderWorkspaces();
