import type { GroupStatus, Settings } from '@job-scout/shared';
import { normaliseTitle, tokenSetRatio } from './parse/title.js';

type DedupeSettings = Settings['dedupe'];

/** What we compare when deciding whether two postings are the same role. */
export type DedupeJob = {
  title: string;
  location: string | null;
  annualisedMin: number | null;
  annualisedMax: number | null;
};

export type DedupeWhy = 'title' | 'pay_and_location';

/** Statuses before the user has done anything with a group; anything else is "actioned". */
const PRE_ACTION: ReadonlySet<GroupStatus> = new Set([
  'filtered',
  'below_threshold',
  'pending_llm',
  'deferred',
  'prefiltered',
  'new',
]);

export const isActioned = (status: GroupStatus): boolean => !PRE_ACTION.has(status);

/** First place name of a location, lower case ("London, Greater London" → "london"). */
const cityOf = (location: string | null): string | null => {
  const city = location?.split(',')[0]?.trim().toLowerCase();
  return city ? city : null;
};

export function sameCity(a: DedupeJob, b: DedupeJob): boolean {
  const ca = cityOf(a.location);
  return ca !== null && ca === cityOf(b.location);
}

/** Do the two pay ranges overlap once each is widened by `tolerance` (0.1 = 10%)? */
export function payBandsOverlap(a: DedupeJob, b: DedupeJob, tolerance: number): boolean {
  const aMax = a.annualisedMax ?? a.annualisedMin;
  const bMax = b.annualisedMax ?? b.annualisedMin;
  const aMin = a.annualisedMin ?? aMax;
  const bMin = b.annualisedMin ?? bMax;
  if (aMin === null || aMax === null || bMin === null || bMax === null) return false;
  return (
    aMin * (1 - tolerance) <= bMax * (1 + tolerance) &&
    bMin * (1 - tolerance) <= aMax * (1 + tolerance)
  );
}

/**
 * The cheap half of the duplicate test (SPEC §8.2): similar titles, or the same pay band in the
 * same city. Run this first so the costly vector comparison only happens for real candidates.
 * `titleScore` is returned so callers can rank candidates.
 */
export function looksLikeSameRole(
  a: DedupeJob,
  b: DedupeJob,
  settings: Pick<DedupeSettings, 'titleTokenSetRatio' | 'payBandTolerance'>,
): { match: boolean; why: DedupeWhy | null; titleScore: number } {
  const titleScore = tokenSetRatio(
    normaliseTitle(a.title).normalised,
    normaliseTitle(b.title).normalised,
  );
  if (titleScore >= settings.titleTokenSetRatio) return { match: true, why: 'title', titleScore };
  if (sameCity(a, b) && payBandsOverlap(a, b, settings.payBandTolerance)) {
    return { match: true, why: 'pay_and_location', titleScore };
  }
  return { match: false, why: null, titleScore };
}

/** Same role posted twice: text similarity at least `similarity` AND the cheap test passes. */
export function isDuplicate(
  similarity: number,
  a: DedupeJob,
  b: DedupeJob,
  settings: DedupeSettings,
): { dup: boolean; why: DedupeWhy | null } {
  if (similarity < settings.similarity) return { dup: false, why: null };
  const { match, why } = looksLikeSameRole(a, b, settings);
  return { dup: match, why };
}

/** The facts used to choose which posting represents a group. */
export type CanonicalCandidate = {
  id: string;
  hasPay: boolean;
  ir35Known: boolean;
  descriptionLength: number;
  postedAt: string | null;
};

/** Most complete posting: has pay, then IR35 known, then longest description, then earliest. */
export function pickCanonical(candidates: CanonicalCandidate[]): string | null {
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(b.hasPay) - Number(a.hasPay) ||
      Number(b.ir35Known) - Number(a.ir35Known) ||
      b.descriptionLength - a.descriptionLength ||
      (a.postedAt ?? '9999').localeCompare(b.postedAt ?? '9999') ||
      a.id.localeCompare(b.id),
  );
  return ranked[0]?.id ?? null;
}

/** Of two groups that turned out to be one, the one that keeps going: first seen, then lowest id. */
export function olderGroup(
  a: { id: string; firstSeenAt: string },
  b: { id: string; firstSeenAt: string },
): 'a' | 'b' {
  const order = a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id);
  return order <= 0 ? 'a' : 'b';
}
