import './styles.css';
import {
  chooseGalaxyFolder,
  createDocumentFile,
  createGalaxy,
  initializeGalaxyPath,
  isTauriRuntime,
  loadAiSettings,
  loadDefaultGuide,
  loadGalaxy,
  loadRecentState,
  onMenuEvent,
  openFileDialog,
  readDocumentFile,
  saveAiSettings,
  saveDocumentAsDialog,
  saveDocumentFile,
  type DocumentFile,
} from './backend';
import { deserializeHvy, isMountedDocumentDirty, markMountedDocumentSaved, mountHvyDocument, serializeMountedDocument } from './hvy';
import { state } from './state';
import { getHvyTemplate } from './templates';
import { render, type UiHandlers } from './ui';

let mountRoot: HTMLElement | null = null;
let mountGeneration = 0;

const handlers: UiHandlers = {
  newGalaxy: () => {
    state.newGalaxyDialogOpen = true;
    state.status = 'Ready';
    rerender();
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="galaxyName"]')?.focus();
    });
  },
  createGalaxy: (name) => void runBusy('Creating galaxy...', async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      state.newGalaxyDialogOpen = true;
      state.status = 'Galaxy name is required';
      return;
    }
    state.newGalaxyDialogOpen = false;
    const galaxy = await createGalaxy(trimmed);
    upsertGalaxy(galaxy);
    state.selectedGalaxyPath = galaxy.path;
    await refreshRecents();
  }),
  cancelNewGalaxy: () => {
    state.newGalaxyDialogOpen = false;
    state.status = 'Ready';
    rerender();
  },
  newDocumentInGalaxy: (galaxyPath) => {
    state.newDocumentGalaxyPath = galaxyPath;
    state.status = 'Ready';
    rerender();
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="documentName"]')?.focus();
    });
  },
  createDocumentInGalaxy: (name, templateId) => void runBusy('Creating HVY document...', async () => {
    const galaxyPath = state.newDocumentGalaxyPath;
    const fileName = documentFileName(name);
    if (!galaxyPath) return;
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    state.newDocumentGalaxyPath = null;
    const file = await createDocumentFile({
      galaxyPath,
      relativePath: fileName,
      template: applyTemplateTitle(getHvyTemplate(templateId).content, documentTitle(fileName)),
    });
    upsertGalaxy(await loadGalaxy(galaxyPath));
    state.selectedGalaxyPath = galaxyPath;
    await openDocument(file, { isNew: true });
    await refreshRecents();
  }),
  cancelNewDocument: () => {
    state.newDocumentGalaxyPath = null;
    state.status = 'Ready';
    rerender();
  },
  openAiSettings: () => {
    state.aiSettingsDialogOpen = true;
    state.status = 'Ready';
    rerender();
  },
  saveAiSettings: (provider, baseUrl, apiKey, model) => void runBusy('Saving AI settings...', async () => {
    state.aiSettings = await saveAiSettings({ provider, baseUrl, apiKey, model });
    state.aiSettingsDialogOpen = false;
    state.status = 'Saved AI settings';
  }),
  cancelAiSettings: () => {
    state.aiSettingsDialogOpen = false;
    state.status = 'Ready';
    rerender();
  },
  openGalaxy: () => void runBusy('Opening galaxy...', async () => {
    const candidate = await chooseGalaxyFolder();
    if (!candidate) return;
    const galaxy = candidate.hasManifest
      ? await loadGalaxy(candidate.path)
      : await confirmGalaxyInitialization(candidate.path, candidate.defaultName);
    if (!galaxy) {
      state.status = 'Ready';
      return;
    }
    upsertGalaxy(galaxy);
    state.selectedGalaxyPath = galaxy.path;
    await refreshRecents();
    rerender();
  }),
  openFile: () => void runBusy('Opening file...', async () => {
    const file = await openFileDialog();
    if (!file) return;
    await openDocument(file);
    await refreshRecents();
  }),
  openRecentGalaxy: (path) => void runBusy('Opening recent galaxy...', async () => {
    upsertGalaxy(await loadGalaxy(path));
    state.selectedGalaxyPath = path;
    await refreshRecents();
    rerender();
  }),
  openRecentFile: (path) => void runBusy('Opening recent file...', async () => {
    await openDocument(await readDocumentFile(path));
    await refreshRecents();
  }),
  selectFile: (path) => void runBusy('Opening file...', async () => {
    await openDocument(await readDocumentFile(path));
    await refreshRecents();
  }),
  toggleMode: () => {
    if (!state.document) return;
    if (state.document.readOnly) {
      state.status = 'The HVY guide is read-only';
      rerender();
      void mountCurrentDocument();
      return;
    }
    const document = state.document.mounted?.document;
    state.document.mode = state.document.mode === 'viewer' ? 'editor' : 'viewer';
    rerender();
    void mountCurrentDocument(document);
  },
  save: () => void saveCurrentDocument(),
  saveAs: () => void saveCurrentDocumentAs(),
  createFile: () => void createBlankDocument(),
};

void boot();

async function boot(): Promise<void> {
  setupErrorSurface();
  mountRoot = render(state, handlers);
  try {
    await refreshRecents();
    state.aiSettings = await loadAiSettings();
    await loadRecentGalaxies();
    mountRoot = render(state, handlers);
    await openDefaultGuide();
    await onMenuEvent((event) => {
      if (event === 'new-galaxy') handlers.newGalaxy();
      if (event === 'open-galaxy') handlers.openGalaxy();
      if (event === 'open-file') handlers.openFile();
      if (event === 'open-guide') void openDefaultGuide({ force: true });
      if (event === 'save') handlers.save();
      if (event === 'save-as') handlers.saveAs();
      if (event.startsWith('recent-galaxy:')) handlers.openRecentGalaxy(event.slice('recent-galaxy:'.length));
      if (event.startsWith('recent-file:')) handlers.openRecentFile(event.slice('recent-file:'.length));
    });
  } catch (error) {
    showStartupError(error);
  }
}

async function refreshRecents(): Promise<void> {
  state.recent = await loadRecentState();
}

async function loadRecentGalaxies(): Promise<void> {
  for (const path of state.recent.galaxies) {
    try {
      upsertGalaxy(await loadGalaxy(path));
    } catch {
      // Recents are pruned by the backend when they are opened or reloaded.
    }
  }
  state.selectedGalaxyPath = state.galaxies[0]?.path ?? null;
}

async function openDefaultGuide(options: { force?: boolean } = {}): Promise<void> {
  if (!isTauriRuntime()) return;
  if (!options.force && (state.document || state.selectedFilePath)) return;
  try {
    await openDocument(await loadDefaultGuide(), { defaultDocument: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load HVY guide';
    mountRoot = render(state, handlers);
  }
}

async function openDocument(file: DocumentFile, options: { defaultDocument?: boolean; isNew?: boolean } = {}): Promise<void> {
  state.document?.mounted?.mount.destroy();
  const bytes = new Uint8Array(file.bytes);
  const document = await deserializeHvy(bytes, file.extension);
  state.document = {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: options.isNew ? 'editor' : 'viewer',
    dirty: options.isNew === true,
    readOnly: options.defaultDocument === true,
    isNew: options.isNew === true,
    mounted: null,
  };
  state.selectedFilePath = options.defaultDocument ? null : file.path;
  state.status = options.defaultDocument ? 'Opened HVY guide' : options.isNew ? 'Created blank HVY document' : `Opened ${file.name}`;
  rerender();
  await mountCurrentDocument(document);
}

async function mountCurrentDocument(document = state.document?.mounted?.document): Promise<void> {
  if (!state.document || !mountRoot || !document) return;
  state.document.mounted?.mount.destroy();
  const generation = ++mountGeneration;
  const mounted = await mountHvyDocument(mountRoot, document, state.document.mode, {
    storageKey: documentStorageKey(state.document.path || state.document.name),
    onDocumentChange: (event) => {
      if (generation !== mountGeneration) return;
      setDocumentDirty(event.dirty);
    },
  });
  state.document.mounted = mounted;
  setDocumentDirty(state.document.isNew ? true : isMountedDocumentDirty(mounted), { preserveStatus: true });
}

function setDocumentDirty(dirty: boolean, options: { preserveStatus?: boolean } = {}): void {
  if (!state.document || state.document.readOnly) return;
  const changed = state.document.dirty !== dirty;
  state.document.dirty = dirty;
  if (!options.preserveStatus || changed) {
    state.status = dirty ? 'Unsaved changes' : `Saved ${state.document.name}`;
  }
  updateDirtyChrome();
}

function updateDirtyChrome(): void {
  const openDocument = state.document;
  if (!openDocument) return;
  const label = openDocument.readOnly ? 'Read only' : openDocument.dirty ? 'Unsaved' : 'Saved';
  const indicator = document.querySelector<HTMLElement>('.dirty-indicator');
  indicator?.replaceChildren(document.createTextNode(label));
  indicator?.setAttribute('data-state', openDocument.readOnly ? 'read-only' : openDocument.dirty ? 'dirty' : 'clean');
  const saveButton = document.querySelector<HTMLButtonElement>('[data-action="save"]');
  if (openDocument.dirty && !openDocument.readOnly) {
    saveButton?.removeAttribute('disabled');
  } else {
    saveButton?.setAttribute('disabled', '');
  }
  document.querySelector('.status-bar')?.replaceChildren(document.createTextNode(state.status));
}

async function saveCurrentDocument(): Promise<void> {
  await runBusy('Saving...', async () => {
    if (!state.document?.mounted) return;
    if (state.document.readOnly) {
      state.status = 'The HVY guide is read-only';
      rerender();
      return;
    }
    if (state.document.isNew || !state.document.path) {
      await performSaveCurrentDocumentAs();
      return;
    }
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
    await saveDocumentFile({ path: state.document.path, bytes });
    markMountedDocumentSaved(state.document.mounted);
    state.document.dirty = false;
    state.status = `Saved ${state.document.name}`;
    const document = state.document.mounted.document;
    await refreshOpenGalaxyForFile(state.document.path);
    await refreshRecents();
    rerender();
    await mountCurrentDocument(document);
  });
}

async function saveCurrentDocumentAs(): Promise<void> {
  await runBusy('Saving as...', async () => {
    await performSaveCurrentDocumentAs();
  });
}

async function performSaveCurrentDocumentAs(): Promise<void> {
  if (!state.document?.mounted) return;
  if (state.document.readOnly) {
    state.status = 'The HVY guide is read-only';
    rerender();
    return;
  }
  const bytes = Array.from(serializeMountedDocument(state.document.mounted));
  const file = await saveDocumentAsDialog({ suggestedName: state.document.name, bytes });
  if (!file) return;
  const document = await deserializeHvy(new Uint8Array(file.bytes), file.extension);
  state.document = {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: state.document.mode,
    dirty: false,
    readOnly: false,
    isNew: false,
    mounted: null,
  };
  state.selectedFilePath = file.path;
  state.status = `Saved ${file.name}`;
  await refreshOpenGalaxyForFile(file.path);
  await refreshRecents();
  rerender();
  await mountCurrentDocument(document);
}

async function createBlankDocument(): Promise<void> {
  await runBusy('Creating blank document...', async () => {
    const bytes = Array.from(new TextEncoder().encode(defaultHvyDocument()));
    await openDocument({
      path: '',
      name: 'Untitled.hvy',
      extension: '.hvy',
      bytes,
    }, { isNew: true });
  });
}

async function refreshOpenGalaxyForFile(filePath: string): Promise<void> {
  const galaxy = state.galaxies.find((candidate) => filePath.startsWith(candidate.path));
  if (!galaxy) return;
  upsertGalaxy(await loadGalaxy(galaxy.path));
}

function upsertGalaxy(galaxy: Awaited<ReturnType<typeof loadGalaxy>>): void {
  const index = state.galaxies.findIndex((candidate) => candidate.path === galaxy.path);
  if (index >= 0) {
    state.galaxies[index] = galaxy;
  } else {
    state.galaxies.push(galaxy);
  }
  sortGalaxies();
}

function sortGalaxies(): void {
  state.galaxies.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function rerender(): void {
  state.document?.mounted?.mount.destroy();
  if (state.document) {
    state.document.mounted = null;
  }
  mountRoot = render(state, handlers);
}

async function runBusy(label: string, task: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  const document = state.document?.mounted?.document;
  state.busy = true;
  state.error = null;
  state.status = label;
  try {
    await task();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    const documentToMount = state.document?.mounted?.document ?? document;
    rerender();
    await mountCurrentDocument(documentToMount);
  }
}

function defaultHvyDocument(title = 'Untitled'): string {
  return `---
hvy_version: 0.1
title: ${JSON.stringify(title)}
---
`;
}

function documentFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().endsWith('.hvy') ? trimmed : `${trimmed}.hvy`;
}

function documentTitle(fileName: string): string {
  return fileName.replace(/\.hvy$/i, '');
}

function applyTemplateTitle(template: string, title: string): string {
  return template.replace(/^title:.*$/m, `title: ${JSON.stringify(title)}`);
}

function documentStorageKey(identifier: string): string {
  return `hvy-galaxy:document:${identifier}`;
}

async function confirmGalaxyInitialization(path: string, defaultName: string) {
  const shouldInitialize = window.confirm(
    `"${defaultName}" is not an HVY galaxy yet. Create .hvygalaxy.json in this folder?`
  );
  return shouldInitialize ? initializeGalaxyPath(path) : null;
}

function setupErrorSurface(): void {
  window.addEventListener('error', (event) => {
    showStartupError(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    showStartupError(event.reason);
  });
}

function showStartupError(error: unknown): void {
  state.error = error instanceof Error ? error.message : String(error);
  state.status = 'Startup error';
  mountRoot = render(state, handlers);
}
