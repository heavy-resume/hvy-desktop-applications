import { visitBlocks } from '../../../heavy-file-format/src/block-traversal';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import type { VisualBlock } from '../../../heavy-file-format/src/editor/types';
import { validateCliItemStore } from './cliItemStore';
import {
  QUEUE_PLUGIN_ID,
  readCollectionBlockConfig,
  readQueueBlockConfig,
  readWebApiBlockConfig,
  WEB_API_PLUGIN_ID,
  WEB_COLLECTION_PLUGIN_ID,
  type CollectionBlockConfig,
  type QueueBlockConfig,
  type WebApiBlockConfig,
} from './configs';

export interface WebAutomationBlocks {
  webApis: Array<{ blockId: string; block: VisualBlock; config: WebApiBlockConfig }>;
  collections: Array<{ blockId: string; block: VisualBlock; config: CollectionBlockConfig }>;
  queues: Array<{ blockId: string; block: VisualBlock; config: QueueBlockConfig }>;
  /** Blocks whose configuration could not be read. */
  problems: WebAutomationProblem[];
}

/** A problem with one block, or with several blocks together (such as a duplicate id). */
export interface WebAutomationProblem {
  blocks: VisualBlock[];
  message: string;
}

/** Reads every web automation block in a document through the block configuration readers. */
export function readWebAutomationBlocks(document: VisualDocument): WebAutomationBlocks {
  const blocks: WebAutomationBlocks = { webApis: [], collections: [], queues: [], problems: [] };
  visitBlocks(document.sections, (block) => {
    const pluginId = block.schema.plugin;
    const blockId = block.schema.id || '(unnamed plugin)';
    const value = block.schema.pluginConfig;
    const report = (errors: string[]) => blocks.problems.push(...errors.map((message) => ({ blocks: [block], message })));
    if (pluginId === WEB_API_PLUGIN_ID) {
      const result = readWebApiBlockConfig(value);
      if (result.ok) blocks.webApis.push({ blockId, block, config: result.value });
      else report(result.errors);
    } else if (pluginId === WEB_COLLECTION_PLUGIN_ID) {
      const result = readCollectionBlockConfig(value);
      if (result.ok) blocks.collections.push({ blockId, block, config: result.value });
      else report(result.errors);
    } else if (pluginId === QUEUE_PLUGIN_ID) {
      const result = readQueueBlockConfig(value);
      if (result.ok) blocks.queues.push({ blockId, block, config: result.value });
      else report(result.errors);
    }
  });
  return blocks;
}

function duplicates<T>(entries: T[], id: (entry: T) => string): Array<{ id: string; entries: T[] }> {
  const byId = new Map<string, T[]>();
  for (const entry of entries) byId.set(id(entry), [...(byId.get(id(entry)) ?? []), entry]);
  return [...byId].filter(([, group]) => group.length > 1).map(([key, group]) => ({ id: key, entries: group }));
}

/** Every problem with a document's web automation blocks, checked against each other and the document's templates. */
export function findWebAutomationProblems(document: VisualDocument): WebAutomationProblem[] {
  const blocks = readWebAutomationBlocks(document);
  const problems = [...blocks.problems];
  const capabilities = [
    ...blocks.webApis.map(({ block, config }) => ({ block, id: config.capability.capabilityId })),
    ...blocks.collections.map(({ block, config }) => ({ block, id: config.collection.capabilityId })),
  ];
  for (const { id, entries } of duplicates(capabilities, (entry) => entry.id)) {
    problems.push({ blocks: entries.map((entry) => entry.block), message: `Capability id "${id}" is used by more than one block.` });
  }
  for (const { id, entries } of duplicates(blocks.queues, (entry) => entry.config.queueId)) {
    problems.push({ blocks: entries.map((entry) => entry.block), message: `Queue id "${id}" is used by more than one block.` });
  }

  for (const { block, config } of blocks.collections) {
    if (!config.output) continue;
    problems.push(...validateCliItemStore(document, config.output.store).map((message) => ({ blocks: [block], message })));
  }

  for (const { block, config } of blocks.queues) {
    if (config.target.pluginId !== WEB_API_PLUGIN_ID) continue;
    if (config.target.method !== 'call') {
      problems.push({ blocks: [block], message: `galaxy.web-api has no "${config.target.method}" method for queues.` });
      continue;
    }
    const capabilityId = String(config.target.args.capabilityId ?? '');
    const endpointId = String(config.target.args.endpointId ?? '');
    const api = blocks.webApis.find(({ config: candidate }) => candidate.capability.capabilityId === capabilityId);
    if (!api) {
      problems.push({ blocks: [block], message: `the queue targets "${capabilityId}", which no web API block in this document defines.` });
      continue;
    }
    if (!api.config.capability.endpoints.some((candidate) => candidate.id === endpointId)) {
      problems.push({ blocks: [block], message: `"${capabilityId}" has no endpoint "${endpointId}".` });
    }
  }
  return problems;
}

/**
 * Checks a document's web automation blocks against each other and against
 * the document's templates. Empty means the blocks can run as configured.
 */
export function checkWebAutomationDocument(document: VisualDocument): string[] {
  return findWebAutomationProblems(document).map(({ blocks, message }) => (
    blocks.length === 1 ? `${blocks[0].schema.id || '(unnamed plugin)'}: ${message}` : message
  ));
}
