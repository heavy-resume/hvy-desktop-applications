import type { DocumentExtension } from './backend';

const templateFiles = import.meta.glob<string>('./templates/*.{hvy,thvy}', {
  eager: true,
  import: 'default',
  query: '?raw',
});

export interface HvyTemplate {
  id: string;
  fileName: string;
  name: string;
  extension: Extract<DocumentExtension, '.hvy' | '.thvy'>;
  content: string;
}

const fallbackTemplate: HvyTemplate = {
  id: 'blank.thvy',
  fileName: 'blank.thvy',
  name: 'blank.thvy',
  extension: '.thvy',
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

function templateFromFile(path: string, content: string): HvyTemplate {
  const fileName = path.split('/').pop() ?? path;
  const extension = fileName.toLowerCase().endsWith('.hvy') ? '.hvy' : '.thvy';
  return {
    id: fileName,
    fileName,
    name: fileName.replace(/\.(t?hvy)$/i, ''),
    extension,
    content,
  };
}
