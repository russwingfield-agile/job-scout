import { type Suggestion, SuggestionIdRequestSchema } from '@job-scout/shared';
import { Hono } from 'hono';
import type { Deps } from '../../container.js';
import { type SkipFact, type SuggestionWithPatch, suggestChanges } from '../../core/suggestions.js';
import { AppError } from '../../lib/errors.js';
import { toIso } from '../../lib/time.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

const DAY_MS = 86_400_000;
const DISMISSED_KEY = 'dismissedSuggestions';
/** Remember at most this many dismissals so the stored list cannot grow for ever. */
const MAX_DISMISSED = 200;

const dismissedIds = async (deps: Deps): Promise<string[]> => {
  const stored = (await deps.repos.settings.getAll())[DISMISSED_KEY];
  return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : [];
};

/** Everything the skips suggest right now, before dismissals are applied. */
async function computeSuggestions(deps: Deps): Promise<SuggestionWithPatch[]> {
  const { feedback, working } = await deps.settings.get();
  const since = toIso(
    new Date(deps.clock.now().getTime() - feedback.suggestionWindowDays * DAY_MS),
  );
  const [skips, profiles] = await Promise.all([
    deps.repos.applications.listSkipsSince(since),
    deps.repos.profiles.listActive(),
  ]);
  const profileByCv = new Map(profiles.map((p) => [p.cvId, p.id]));

  const dayRateOf = (s: (typeof skips)[number]): number | null => {
    const pay = s.payMax ?? s.payMin;
    if (pay === null) return null;
    if (s.payPeriod === 'day') return pay;
    if (s.payPeriod === 'hour') return pay * working.hoursPerDay;
    return null;
  };
  const facts: SkipFact[] = skips.flatMap((s) =>
    s.reason === null
      ? []
      : [
          {
            reason: s.reason,
            profileId: s.bestCvId === null ? null : (profileByCv.get(s.bestCvId) ?? null),
            dayRate: dayRateOf(s),
          },
        ],
  );
  return suggestChanges(facts, profiles, feedback);
}

const strip = ({ patch: _patch, ...suggestion }: SuggestionWithPatch): Suggestion => suggestion;

/** Advice from your skips ("raise your minimum rate?"), with one-click apply and dismiss. */
export const suggestionsRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const deps = c.var.deps;
    const dismissed = new Set(await dismissedIds(deps));
    const all = await computeSuggestions(deps);
    return c.json(all.filter((s) => !dismissed.has(s.id)).map(strip));
  })
  .post('/apply', validate('json', SuggestionIdRequestSchema), async (c) => {
    const deps = c.var.deps;
    const { id } = c.req.valid('json');
    const suggestion = (await computeSuggestions(deps)).find((s) => s.id === id);
    if (!suggestion) throw new AppError('NOT_FOUND', 'That suggestion is no longer relevant.');
    const profile = await deps.repos.profiles.getById(suggestion.profileId);
    if (!profile) throw new AppError('NOT_FOUND', 'Search profile not found');

    const { id: _id, cvId: _cvId, updatedAt: _updatedAt, ...editable } = profile;
    await deps.repos.profiles.update(
      profile.id,
      { ...editable, ...suggestion.patch },
      toIso(deps.clock.now()),
    );
    return c.json({ applied: true });
  })
  .post('/dismiss', validate('json', SuggestionIdRequestSchema), async (c) => {
    const deps = c.var.deps;
    const { id } = c.req.valid('json');
    const dismissed = [...new Set([...(await dismissedIds(deps)), id])].slice(-MAX_DISMISSED);
    await deps.repos.settings.put(DISMISSED_KEY, dismissed, toIso(deps.clock.now()));
    return c.json({ dismissed: true });
  });
