export interface WorkspaceFileConversionAction {
  label: 'Convert to Template' | 'Convert to Document';
  toTemplate: boolean;
}

export function workspaceFileConversionAction(name: string, relativePath: string): WorkspaceFileConversionAction | null {
  const extension = name.match(/\.(hvy|thvy|phvy)$/i)?.[1]?.toLowerCase();
  if (!extension) return null;
  if (extension === 'hvy') return { label: 'Convert to Template', toTemplate: true };
  if (extension === 'thvy') return { label: 'Convert to Document', toTemplate: false };
  const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  const isWorkspaceTemplate = normalizedPath.startsWith('templates/');
  return isWorkspaceTemplate
    ? { label: 'Convert to Document', toTemplate: false }
    : { label: 'Convert to Template', toTemplate: true };
}
