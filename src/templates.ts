import type { SavedTemplate } from './backend';

const templateFiles = import.meta.glob<string>('./templates/*.thvy', {
  eager: true,
  import: 'default',
  query: '?raw',
});

export interface HvyTemplate {
  id: string;
  fileName: string;
  name: string;
  scope: 'bundled' | 'app' | 'workspace';
  content: string;
}

const fallbackTemplate: HvyTemplate = {
  id: 'blank.thvy',
  fileName: 'blank.thvy',
  name: 'blank.thvy',
  scope: 'bundled',
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

function templateFromFile(path: string, content: string): HvyTemplate {
  const fileName = path.split('/').pop() ?? path;
  return {
    id: fileName,
    fileName,
    name: fileName.replace(/\.(t?hvy)$/i, ''),
    scope: 'bundled',
    content,
  };
}

function templateFromSaved(template: SavedTemplate): HvyTemplate {
  return {
    id: template.id,
    fileName: template.name,
    name: template.name.replace(/\.thvy$/i, ''),
    scope: template.scope,
    content: new TextDecoder().decode(new Uint8Array(template.bytes)),
  };
}
