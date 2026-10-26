import { registerHvyCliPluginCommands, type HvyCliPluginLintCheck } from '../../../heavy-file-format/src/cli-core/plugin-command-registry';
import { findBlockForVirtualDirectory } from '../../../heavy-file-format/src/cli-core/virtual-file-system';
import { QUEUE_PLUGIN_ID, readProfileContextBlockConfig, WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID, WEB_PROFILE_CONTEXT_PLUGIN_ID } from './configs';
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
    'This plugin is a signed-in web API: a service page, its session, and its endpoints, in plugin.json pluginConfig.',
    'Scripts call an endpoint with doc.plugins.call("galaxy.web-api", "call", {"capabilityId": ..., "endpointId": ..., "input": {...}, "on_complete": handler, "on_error": handler}).',
    'The user allows the plugin per file, and approves the service at sign-in; changing the endpoints asks for approval again.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.web-api', description: 'Create a web API block. Edit plugin.json for the service page, session, and endpoints.' }],
  operationCommands: [],
  lintChecks: [blockProblems],
});

registerHvyCliPluginCommands({
  name: 'galaxy-web-collection',
  pluginId: WEB_COLLECTION_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-web-collection',
  componentHints: [
    'This plugin collects records from web pages: start pages, site patterns, limits, and an optional output into a component-list, in plugin.json pluginConfig.',
    'Scripts start a run with doc.plugins.call("galaxy.web-collection", "collect", {"capabilityId": ..., "on_complete": handler}).',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.web-collection', description: 'Create a web collection block. Edit plugin.json for start pages, patterns, and output.' }],
  operationCommands: [],
  lintChecks: [blockProblems],
});

registerHvyCliPluginCommands({
  name: 'galaxy-queue',
  pluginId: QUEUE_PLUGIN_ID,
  helpTopic: 'hvy plugin galaxy-queue',
  componentHints: [
    'This plugin is a paced, retrying queue in front of another plugin method (its target), in plugin.json pluginConfig.',
    'Scripts add work with doc.plugins.call("galaxy.queue", "enqueue", {"queueId": ..., "key": ..., "input": {...}}) and receive results through "on_result".',
    'pluginConfig.state is the queue as of the last save; it is written by the app, not by hand.',
  ],
  addCommands: [{ command: 'hvy insert INDEX plugin SECTION_PATH [ID|--id ID] galaxy.queue', description: 'Create a queue block. Edit plugin.json for its target, pacing, and retries.' }],
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
