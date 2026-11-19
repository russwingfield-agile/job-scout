import type { Settings, SettingsPatch } from '@job-scout/shared';
import { applyPatch, mergeSettings } from '../core/settingsMerge.js';
import type { Repos } from '../db/repos/index.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/log.js';
import { toIso } from '../lib/time.js';
import type { Clock } from '../ports/clock.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export type SettingsService = {
  /** Defaults merged with stored overrides; cached for the lifetime of this service instance. */
  get(): Promise<Settings>;
  update(patch: SettingsPatch): Promise<Settings>;
};

/** One instance per request/invocation (see container.ts) so reads are cached only that long. */
export function createSettingsService(deps: {
  repos: Repos;
  clock: Clock;
  log: Logger;
}): SettingsService {
  let cached: Promise<Settings> | undefined;

  const load = async (): Promise<Settings> => {
    const stored = await deps.repos.settings.getAll();
    const { settings, invalidSections } = mergeSettings(DEFAULT_SETTINGS, stored);
    if (invalidSections.length > 0) {
      deps.log.warn({
        stage: 'settings',
        msg: 'ignored invalid stored overrides',
        sections: invalidSections,
      });
    }
    return settings;
  };

  return {
    get() {
      cached ??= load();
      return cached;
    },

    async update(patch) {
      const stored = await deps.repos.settings.getAll();
      const result = applyPatch(DEFAULT_SETTINGS, stored, patch);
      if (!result.ok) {
        throw new AppError('VALIDATION', 'Invalid settings', { issues: result.issues });
      }
      const now = toIso(deps.clock.now());
      for (const [section, value] of Object.entries(result.overrides)) {
        await deps.repos.settings.put(section, value, now);
      }
      cached = Promise.resolve(result.settings);
      return result.settings;
    },
  };
}
