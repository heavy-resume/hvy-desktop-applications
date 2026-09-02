import { describe, expect, it } from 'vitest';
import { parentDirectoryForRelativePath, workspaceDropTargetFromElement } from './workspaceDropTarget';

function fakeElement(
  matches: Record<string, Element | null>,
  options: { dataset?: Record<string, string>; parentElement?: Element | null; query?: Record<string, Element | null> } = {},
): Element {
  return {
    dataset: options.dataset ?? {},
    parentElement: options.parentElement ?? null,
    closest: (selector: string) => matches[selector] ?? null,
    querySelector: (selector: string) => options.query?.[selector] ?? null,
  } as unknown as Element;
}

describe('workspaceDropTargetFromElement', () => {
  it('targets the folder containing a dropped-on child row', () => {
    const folderTarget = fakeElement({}, {
      dataset: { workspacePath: '/workspaces/example', targetDirectory: 'Projects/Alpha' },
    });
    const folderDetails = fakeElement({}, {
      query: { ':scope > [data-workspace-folder-target="true"]': folderTarget },
    });
    const folderContents = fakeElement({}, { parentElement: folderDetails });
    const embeddedFileParent = fakeElement({ '.tree': folderContents });
    const embeddedFileTree = fakeElement({}, { parentElement: embeddedFileParent });
    const workspaceRoot = fakeElement({}, { dataset: { workspacePath: '/workspaces/example' } });
    const childRow = fakeElement({
      '.tree [data-workspace-folder-target="true"]': null,
      '.tree': embeddedFileTree,
      '.workspace-root': workspaceRoot,
    });

    expect(workspaceDropTargetFromElement(childRow)).toEqual({
      element: folderTarget,
      workspacePath: '/workspaces/example',
      targetDirectory: 'Projects/Alpha',
    });
  });

  it('keeps workspace-level drops at the workspace root', () => {
    const rootTree = fakeElement({}, { parentElement: fakeElement({}) });
    const workspaceRoot = fakeElement({}, { dataset: { workspacePath: '/workspaces/example' } });
    const rootFile = fakeElement({
      '.tree [data-workspace-folder-target="true"]': null,
      '.tree': rootTree,
      '.workspace-root': workspaceRoot,
    });

    expect(workspaceDropTargetFromElement(rootFile)).toEqual({
      element: workspaceRoot,
      workspacePath: '/workspaces/example',
      targetDirectory: '',
    });
  });

  it('installs workspace-level drops into the active templates view', () => {
    const rootTree = fakeElement({}, { parentElement: fakeElement({}) });
    const workspaceRoot = fakeElement({}, {
      dataset: { workspacePath: '/workspaces/example', targetDirectory: 'templates' },
    });
    const rootFile = fakeElement({
      '.tree [data-workspace-folder-target="true"]': null,
      '.tree': rootTree,
      '.workspace-root': workspaceRoot,
    });

    expect(workspaceDropTargetFromElement(rootFile)).toEqual({
      element: workspaceRoot,
      workspacePath: '/workspaces/example',
      targetDirectory: 'templates',
    });
  });
});

describe('parentDirectoryForRelativePath', () => {
  it('uses the containing folder as the destination for a nested file', () => {
    expect(parentDirectoryForRelativePath('clients/acme/notes.hvy')).toBe('clients/acme');
  });

  it('uses the workspace root as the destination for a root file', () => {
    expect(parentDirectoryForRelativePath('notes.hvy')).toBe('');
  });
});
