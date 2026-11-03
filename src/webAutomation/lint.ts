import { registerHvyCliPluginCommands, type HvyCliPluginLintCheck } from '../../../heavy-file-format/src/cli-core/plugin-command-registry';
import { findBlockForVirtualDirectory } from '../../../heavy-file-format/src/cli-core/virtual-file-system';
import { QUEUE_PLUGIN_ID, readProfileContextBlockConfig, SIMILARITY_PLUGIN_ID, WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID, WEB_PROFILE_CONTEXT_PLUGIN_ID } from './configs';
import { isIgnoredProfileContext } from './profileContexts';
import { findWebAutomationProblems } from './documentBlocks';

/** `hvy lint` reports a web automation block's problems on that block: its own, and those it shares with others. */
const blockProblems: HvyCliPluginLintCheck = (context) => {
  const block = findBlockForVirtualDirectory(context.document, context.path);
  if (!block) return [];
  return findWebAutomationProblems(context.document)
    .filter((problem) => problem.blocks.includes(block))
    .map(({ message }) => ({ message }));
};

registerHvyCliPluginCommands({
  name: 'galaxy-web-api',
  pluginId: WEB_API_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-web-api',
  componentHints: [
    'This plugin is a signed-in web API: a service page, its session, and its endpoints, as indented JSON in plugin.txt (its pluginConfig in plugin.json stays empty).',
    'Scripts call an endpoint with doc.plugins.call("galaxy.web-api", "call", {"capabilityId": ..., "endpointId": ..., "input": {...}, "on_complete": handler, "on_error": handler}).',
    'The user allows the plugin per file, and approves the service at sign-in; changing the endpoints asks for approval again.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.web-api', description: 'Create a web API block. Edit plugin.txt (indented JSON) for the service page, session, and endpoints.' }],
  operationCommands: [],
  lintChecks: [blockProblems],
});

registerHvyCliPluginCommands({
  name: 'galaxy-web-collection',
  pluginId: WEB_COLLECTION_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-web-collection',
  componentHints: [
    'This plugin collects records from web pages: start pages, site patterns, limits, and an optional output (into a component-list, or with "kind": "sql" into a table of the document database), as indented JSON in plugin.txt (its pluginConfig in plugin.json stays empty).',
    'Scripts start a run with doc.plugins.call("galaxy.web-collection", "collect", {"capabilityId": ..., "on_complete": handler}).',
    'A script that shows the output registers "on_records" ({"capabilityId": ..., "key": ..., "handler": ...}): the handler gets {"keys": [...]} as each record is written, and reads what changed.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.web-collection', description: 'Create a web collection block. Edit plugin.txt (indented JSON) for start pages, patterns, and output.' }],
  operationCommands: [],
  lintChecks: [blockProblems],
});

registerHvyCliPluginCommands({
  name: 'galaxy-queue',
  pluginId: QUEUE_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-queue',
  componentHints: [
    'This plugin is a paced, retrying queue in front of another plugin method (its target), as indented JSON in plugin.txt (its pluginConfig in plugin.json stays empty).',
    'Scripts add work with doc.plugins.call("galaxy.queue", "enqueue", {"queueId": ..., "key": ..., "input": {...}}) and receive results through "on_result".',
    'Its "state" is the queue as of the last save; it is written by the app, not by hand.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.queue', description: 'Create a queue block. Edit plugin.txt (indented JSON) for its target, pacing, and retries.' }],
  operationCommands: [],
  lintChecks: [blockProblems],
});

/** A context's configuration, and whether another context in its section or container comes first. */
const contextProblems: HvyCliPluginLintCheck = (context) => {
  const block = findBlockForVirtualDirectory(context.document, context.path);
  if (!block) return [];
  const config = readProfileContextBlockConfig(block.schema.pluginConfig);
  return [
    ...(config.ok ? [] : config.errors.map((message) => ({ message }))),
    ...(isIgnoredProfileContext(context.document, block)
      ? [{ message: 'Another web profile context comes first in this section or container, so this one sets nothing.' }]
      : []),
  ];
};

registerHvyCliPluginCommands({
  name: 'galaxy-similarity',
  pluginId: SIMILARITY_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-similarity',
  componentHints: [
    'This plugin ranks a table\'s rows by how similar their text is to a query (such as each job to a resume), and writes each row\'s score into a column. It has no block: scripts call it, and the document declares it in its scripting plugins.',
    'doc.plugins.call("galaxy.similarity", "rank", {"rows": SQL, "key": ..., "text": ..., "query": ..., "embeddings": {"capabilityId": ..., "endpointId": ...}, "write": {"table": ..., "key": ..., "column": ...}, "on_complete": handler, "on_error": handler}).',
    '"rows" is a SELECT whose columns include "key" (what identifies a row) and "text" (what is compared). "query" is a string, or {"capabilityId", "endpointId", "documentId", "sections"}: sections of a document a web API block serves, which the script never sees.',
    'Texts are embedded through a web API block\'s endpoint that takes {"input": [texts]} and answers {"data": [{"embedding"}]}, under its approval. Each text is embedded once per source; the vectors are kept in the table __galaxy_similarity_vectors of the document database (internal: two underscores, like the __hvy_ tables of heavy-file-format).',
  ],
  addCommands: [],
  operationCommands: [],
});

registerHvyCliPluginCommands({
  name: 'galaxy-web-profile-context',
  pluginId: WEB_PROFILE_CONTEXT_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-web-profile-context',
  componentHints: [
    'This plugin sets the browser profile, by name, for the web plugins in its section or container and anything nested there: plugin.json pluginConfig.profile.',
    'Web plugins outside any context use the file\'s profile (front matter metadata.galaxy.web_profile). One context per section or container.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin PARENT_PATH [ID|--id ID] galaxy.web-profile-context', description: 'Create a web profile context. Set plugin.json pluginConfig.profile, or let the reader choose it.' }],
  operationCommands: [],
  lintChecks: [contextProblems],
});
