import { describe, expect, it } from 'vitest';
import { loadWorkspaceExpansionState, saveWorkspaceExpansionState } from './workspaceExpansionState';

describe('workspace expansion state', () => {
  it('persists expansion by workspace path', () => {
    saveWorkspaceExpansionState({ '/Work/Alpha': false, '/Work/Beta': true });

    expect(loadWorkspaceExpansionState()).toEqual({
      '/Work/Alpha': false,
      '/Work/Beta': true,
    });
  });

  it('ignores stored values that are not expansion booleans', () => {
    localStorage.setItem('hvy-galaxy:workspace-expansion', JSON.stringify({
      '/Work/Alpha': false,
      '/Work/Beta': 'false',
      '/Work/Gamma': null,
    }));

    expect(loadWorkspaceExpansionState()).toEqual({ '/Work/Alpha': false });
  });
});
