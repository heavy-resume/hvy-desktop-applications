import { QUEUE_PLUGIN_ID, WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID } from './configs';

/**
 * Where a web automation block keeps its settings. A block's directive line holds its pluginConfig as one line of JSON,
 * and these blocks' settings are large (a collection's site setups, a web API's endpoints, a queue's saved state): one
 * line of hundreds of thousands of characters, which saving and its history had to compare whole. So these blocks keep
 * them in the block's text (plugin.txt), as indented JSON, a value a line; their pluginConfig stays empty. Other web
 * plugins (a profile context's one name) keep theirs in pluginConfig.
 */
export const SETTINGS_IN_TEXT: ReadonlySet<string> = new Set([WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID, QUEUE_PLUGIN_ID]);

interface SettingsBlock {
  text?: string;
  schema: { plugin?: string; pluginConfig?: Record<string, unknown> };
}

/**
 * A block's settings, from its text (these blocks) or its pluginConfig, for the block's config reader to check. Text
 * that is not JSON is the reason, as a string: the readers say it, where they say a configuration is unsupported.
 */
export function blockSettings(block: SettingsBlock): unknown {
  if (!SETTINGS_IN_TEXT.has(block.schema.plugin ?? '')) return block.schema.pluginConfig ?? {};
  const text = block.text?.trim() ?? '';
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return `The block's settings (plugin.txt) are not JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** A block's settings to change: its stored ones, as an object (none when they are not one). */
export function storedSettings(block: SettingsBlock): Record<string, unknown> {
  const settings = blockSettings(block);
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? structuredClone(settings as Record<string, unknown>) : {};
}

/** Settings as these blocks keep them in their text: indented JSON, a value a line. */
export function settingsText(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
