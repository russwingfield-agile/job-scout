import type { SearchProfile, Settings, SkipReason, Suggestion } from '@job-scout/shared';

type Feedback = Settings['feedback'];

/** One job you skipped, with what we know about it. */
export type SkipFact = {
  reason: SkipReason;
  profileId: string | null;
  /** The day rate the advert offered, when it stated one. */
  dayRate: number | null;
};

/** What a suggestion would change; applied by the server when you click the button. */
export type SuggestionPatch = Partial<
  Pick<SearchProfile, 'minDayRate' | 'radiusMiles' | 'ir35Preference'>
>;
export type SuggestionWithPatch = Suggestion & { patch: SuggestionPatch };

const RATE_STEP = 25;
const MIN_RADIUS = 5;

const roundUpTo = (n: number, step: number): number => Math.ceil(n / step) * step;
const money = (n: number): string => `£${n.toLocaleString('en-GB')}`;

/**
 * Turn repeated skips into one-click advice (SPEC §10.2):
 * - "rate too low" skips that all sit within `suggestionRateBuffer` above your minimum → raise it;
 * - "wrong location" skips → search a smaller area;
 * - "inside IR35" skips → only show outside-IR35 jobs.
 * Each needs at least `suggestionMinSkips` skips (the caller passes only those in the window).
 */
export function suggestChanges(
  skips: SkipFact[],
  profiles: SearchProfile[],
  s: Pick<Feedback, 'suggestionMinSkips' | 'suggestionRateBuffer'>,
): SuggestionWithPatch[] {
  const out: SuggestionWithPatch[] = [];
  for (const profile of profiles) {
    const mine = skips.filter((k) => k.profileId === profile.id);

    const rates = mine
      .filter((k) => k.reason === 'rate_too_low' && k.dayRate !== null)
      .map((k) => k.dayRate as number);
    if (
      profile.minDayRate !== null &&
      rates.length >= s.suggestionMinSkips &&
      rates.every((r) => r < (profile.minDayRate ?? 0) + s.suggestionRateBuffer)
    ) {
      const target = roundUpTo(Math.max(...rates) + 1, RATE_STEP);
      if (target > profile.minDayRate) {
        out.push({
          id: `min_day_rate:${profile.id}:${target}`,
          profileId: profile.id,
          kind: 'min_day_rate',
          message: `You have skipped ${rates.length} jobs for a low day rate, none above ${money(Math.max(...rates))}. Your minimum is ${money(profile.minDayRate)}.`,
          actionLabel: `Raise minimum to ${money(target)}/day`,
          patch: { minDayRate: target },
        });
      }
    }

    const locationSkips = mine.filter((k) => k.reason === 'location').length;
    if (locationSkips >= s.suggestionMinSkips && profile.radiusMiles > MIN_RADIUS) {
      const radius = Math.max(MIN_RADIUS, Math.floor(profile.radiusMiles / 2));
      out.push({
        id: `radius:${profile.id}:${radius}`,
        profileId: profile.id,
        kind: 'radius',
        message: `You have skipped ${locationSkips} jobs because of the location. You search within ${profile.radiusMiles} miles.`,
        actionLabel: `Search within ${radius} miles`,
        patch: { radiusMiles: radius },
      });
    }

    const irSkips = mine.filter((k) => k.reason === 'inside_ir35').length;
    if (irSkips >= s.suggestionMinSkips && profile.ir35Preference !== 'outside_only') {
      out.push({
        id: `ir35:${profile.id}:outside_only`,
        profileId: profile.id,
        kind: 'ir35',
        message: `You have skipped ${irSkips} jobs for being inside IR35.`,
        actionLabel: 'Only show outside IR35',
        patch: { ir35Preference: 'outside_only' },
      });
    }
  }
  return out;
}
