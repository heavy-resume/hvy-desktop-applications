import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtInPluginIds } from 'virtual:hvy-built-in-plugins';

describe('MCP HVY guidance', () => {
  it('advertises every built-in plugin available in Galaxy', () => {
    const guidance = readFileSync(
      new URL('../src-tauri/resources/hvy-galaxy-ai-guide.hvy', import.meta.url),
      'utf8',
    );

    for (const pluginId of builtInPluginIds) {
      expect(guidance, `missing ${pluginId} from the MCP guidance`).toContain(`\`${pluginId}\``);
    }
  });

  it('does not describe dedicated CLI plugin help as the complete catalog', () => {
    const guidance = readFileSync(
      new URL('../src-tauri/resources/hvy-galaxy-ai-guide.hvy', import.meta.url),
      'utf8',
    );

    expect(guidance).toContain('only the subset with dedicated plugin-specific CLI commands');
    expect(guidance).toContain('It is not the complete built-in plugin catalog.');
  });
});
