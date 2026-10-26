import type { VisualBlock } from '../../../heavy-file-format/src/editor/types';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { readProfileContextBlockConfig, WEB_PROFILE_CONTEXT_PLUGIN_ID } from './configs';

/**
 * Web profile contexts: a galaxy.web-profile-context block sets the browser profile for the web plugins beside it,
 * in its section or container and anything nested there. A web plugin uses the nearest context around it, or the
 * file's profile (profiles.ts) outside any. The document's own sections and containers are the scope, so a context
 * holds no blocks of its own.
 */

/** The lists of blocks a block holds: a container's, a component list's items, a grid's, an expandable's two parts. */
function childLists(block: VisualBlock): VisualBlock[][] {
  return [
    block.schema.containerBlocks ?? [],
    block.schema.componentListBlocks ?? [],
    (block.schema.gridItems ?? []).map((item) => item.block),
    block.schema.expandableStubBlocks?.children ?? [],
    block.schema.expandableContentBlocks?.children ?? [],
    ...(block.schema.kind === 'encrypted' && block.schema.encryptedBlock ? [[block.schema.encryptedBlock]] : []),
  ];
}

export function isProfileContext(block: VisualBlock): boolean {
  return block.schema.plugin === WEB_PROFILE_CONTEXT_PLUGIN_ID;
}

/**
 * The web profile context a block is in: the nearest list around it that has one. A list's first context is its own.
 * Blocks are matched by id: a plugin's view of its block can be a different object from the document's.
 */
export function profileContextFor(document: VisualDocument, target: VisualBlock): VisualBlock | null {
  // Undefined: the target is not in this list. Null: it is, outside any context.
  const search = (list: VisualBlock[], around: VisualBlock | null): VisualBlock | null | undefined => {
    const context = list.find(isProfileContext) ?? around;
    for (const block of list) {
      if (block.id === target.id) return context;
      for (const children of childLists(block)) {
        const found = search(children, context);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  for (const section of document.sections) {
    const found = search(section.blocks, null);
    if (found !== undefined) return found;
  }
  return null;
}

/** The browser profile a context names, or null before one is chosen. */
export function contextProfileName(context: VisualBlock): string | null {
  const config = readProfileContextBlockConfig(context.schema.pluginConfig);
  return config.ok ? config.value.profile ?? null : null;
}

/** Contexts after the first in a list: they set nothing, since the list's first context is its context. */
export function ignoredProfileContexts(document: VisualDocument): VisualBlock[] {
  const ignored: VisualBlock[] = [];
  const check = (list: VisualBlock[]) => {
    ignored.push(...list.filter(isProfileContext).slice(1));
    for (const block of list) for (const children of childLists(block)) check(children);
  };
  for (const section of document.sections) check(section.blocks);
  return ignored;
}

/** Whether this context is one that sets nothing (matched by id, as above). */
export function isIgnoredProfileContext(document: VisualDocument, context: VisualBlock): boolean {
  return ignoredProfileContexts(document).some((block) => block.id === context.id);
}
