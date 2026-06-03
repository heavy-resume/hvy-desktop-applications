import type { DocumentCreationType, SavedTemplate, TemplateExtension, Workspace, WorkspaceTemplateVisibility } from './backend';

const templateFiles = import.meta.glob<string>('./templates/*.{thvy,phvy}', {
  eager: true,
  import: 'default',
  query: '?raw',
});

export interface HvyTemplate {
  id: string;
  fileName: string;
  name: string;
  scope: 'bundled' | 'app' | 'workspace';
  extension: TemplateExtension;
  content: string;
}

const fallbackTemplate: HvyTemplate = {
  id: 'blank.thvy',
  fileName: 'blank.thvy',
  name: 'None',
  scope: 'bundled',
  extension: '.thvy',
  content: `---
hvy_version: 0.1
title: Untitled
---
`,
};

const fallbackPhvyTemplate: HvyTemplate = {
  id: 'blank.phvy',
  fileName: 'blank.phvy',
  name: 'None',
  scope: 'bundled',
  extension: '.phvy',
  content: `---
hvy_version: 0.1
title: Untitled
---
`,
};

const discoveredTemplates = Object.entries(templateFiles)
  .map(([path, content]) => templateFromFile(path, content))
  .sort((left, right) => left.fileName.localeCompare(right.fileName));

export const hvyTemplates: HvyTemplate[] = discoveredTemplates.length > 0 ? discoveredTemplates : [fallbackTemplate];
export const defaultWorkspaceTemplateVisibility: WorkspaceTemplateVisibility = {
  hvyDocuments: true,
  thvyTemplates: true,
  phvyTemplates: true,
  archivedFiles: false,
};

export function getHvyTemplate(id: string): HvyTemplate {
  return hvyTemplates.find((template) => template.id === id) ?? hvyTemplates[0] ?? fallbackTemplate;
}

export function getTemplateById(templates: HvyTemplate[], id: string): HvyTemplate {
  return templates.find((template) => template.id === id) ?? templates[0] ?? fallbackTemplate;
}

export function mergeSavedTemplates(savedTemplates: SavedTemplate[]): HvyTemplate[] {
  const saved = savedTemplates
    .map(templateFromSaved)
    .sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name));
  return [...hvyTemplates, ...saved];
}

export function templatesForDocumentType(
  templates: HvyTemplate[],
  documentType: DocumentCreationType,
  visibility: WorkspaceTemplateVisibility = defaultWorkspaceTemplateVisibility,
): HvyTemplate[] {
  const extension: TemplateExtension = documentType === 'phvy' ? '.phvy' : '.thvy';
  const visible = extension === '.phvy' ? visibility.phvyTemplates : visibility.thvyTemplates;
  const filtered = visible ? templates.filter((template) => template.extension === extension) : [];
  if (filtered.length > 0) return filtered;
  return documentType === 'phvy' ? [fallbackPhvyTemplate] : [fallbackTemplate];
}

export function workspaceTemplateVisibility(workspace: Workspace | null | undefined): WorkspaceTemplateVisibility {
  return {
    ...defaultWorkspaceTemplateVisibility,
    ...(workspace?.manifest.templateVisibility ?? {}),
  };
}

function templateFromFile(path: string, content: string): HvyTemplate {
  const fileName = path.split('/').pop() ?? path;
  const extension = templateExtension(fileName);
  return {
    id: fileName,
    fileName,
    name: fileName.replace(/\.(t?hvy|phvy)$/i, ''),
    scope: 'bundled',
    extension,
    content,
  };
}

function templateFromSaved(template: SavedTemplate): HvyTemplate {
  return {
    id: template.id,
    fileName: template.name,
    name: template.name.replace(/\.(thvy|phvy)$/i, ''),
    scope: template.scope,
    extension: template.extension,
    content: new TextDecoder().decode(new Uint8Array(template.bytes)),
  };
}

function templateExtension(fileName: string): TemplateExtension {
  return fileName.toLowerCase().endsWith('.phvy') ? '.phvy' : '.thvy';
}
