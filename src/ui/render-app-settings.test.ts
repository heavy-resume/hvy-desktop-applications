import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../backend';
import { readAppSettingsForm } from './render-ai-mcp';

describe('Settings, Scheduled jobs', () => {
  it('keeps "Jobs at once" a whole number from 1 to 4, and the saved one when the field isn\'t shown', () => {
    const read = (value: string | null) => {
      const data = new FormData();
      data.set('settingsJson', JSON.stringify({ ...defaultAppSettings(), scheduledJobsAtOnce: 2 }));
      if (value !== null) data.set('scheduledJobsAtOnce', value);
      return readAppSettingsForm(data).scheduledJobsAtOnce;
    };
    expect([read('3'), read('9'), read('0'), read('two'), read(null)]).toEqual([3, 4, 1, 1, 2]);
  });
});
