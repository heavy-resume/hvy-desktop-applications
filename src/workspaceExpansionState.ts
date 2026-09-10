const WORKSPACE_EXPANSION_STORAGE_KEY = 'hvy-galaxy:workspace-expansion';

export function loadWorkspaceExpansionState(): Record<string, boolean> {
  const stored = JSON.parse(localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}

export function saveWorkspaceExpansionState(expandedByPath: Record<string, boolean>): void {
  localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify(expandedByPath));
}
