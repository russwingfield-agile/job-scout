import { SETTINGS_SECTIONS, type Settings, SettingsSchema } from '@job-scout/shared';

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Recursively merge `override` over `base`. Plain objects merge; arrays and scalars replace. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Json = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = deepMerge(base[key], value);
    }
    return out;
  }
  return override;
}

export type PatchIssue = { path: string; message: string };

export type PatchResult =
  | { ok: true; settings: Settings; overrides: Record<string, unknown> }
  | { ok: false; issues: PatchIssue[] };

/**
 * Apply a partial update to the stored overrides. The merged settings are validated as a whole,
 * so cross-field rules (weights sum to 1, badge ordering) apply. On success, `overrides` holds the
 * new stored value for each patched section only.
 */
export function applyPatch(
  defaults: Settings,
  storedOverrides: Record<string, unknown>,
  patch: Record<string, unknown>,
): PatchResult {
  const current = mergeSettings(defaults, storedOverrides).settings;
  const nextOverrides: Record<string, unknown> = {};
  const candidate: Json = { ...current };

  for (const section of SETTINGS_SECTIONS) {
    const sectionPatch = patch[section];
    if (sectionPatch === undefined) continue;
    nextOverrides[section] = deepMerge(storedOverrides[section] ?? {}, sectionPatch);
    candidate[section] = deepMerge(current[section], sectionPatch);
  }

  const parsed = SettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  }
  return { ok: true, settings: parsed.data, overrides: nextOverrides };
}

export type MergeResult = {
  settings: Settings;
  /** Sections whose stored override failed validation and were ignored (defaults used instead). */
  invalidSections: string[];
};

/**
 * Merge stored per-section overrides over defaults. Each section is validated on its own so one
 * corrupt row cannot take the whole settings object down; the final object is validated in full.
 */
export function mergeSettings(defaults: Settings, overrides: Record<string, unknown>): MergeResult {
  const invalidSections: string[] = [];
  const merged: Json = { ...defaults };

  for (const section of SETTINGS_SECTIONS) {
    const override = overrides[section];
    if (override === undefined) continue;
    const candidate = deepMerge(defaults[section], override);
    const probe = SettingsSchema.safeParse({ ...defaults, [section]: candidate });
    if (probe.success) merged[section] = candidate;
    else invalidSections.push(section);
  }

  return { settings: SettingsSchema.parse(merged), invalidSections };
}
