import type { Ir35 } from '@job-scout/shared';

export type Ir35Confidence = 'high' | 'medium' | 'low' | 'none';
export type Ir35Detection = { value: Ir35; confidence: Ir35Confidence };

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\bir[\s-]?35\b/g, 'ir35');

const SEPARATOR = String.raw`\s*(?:status|determination)?\s*[:\-(=]*\s*`;

// "not caught by IR35" is an *outside* statement; strip it before looking for inside wording.
const NOT_CAUGHT =
  /(?:not|isn'?t|n't)\s+(?:be\s+)?(?:caught|covered|subject)\s+(?:by|to)\s+(?:the\s+)?ir35/g;

const OUTSIDE: RegExp[] = [
  /outside\s+(?:of\s+)?(?:the\s+)?ir35/,
  new RegExp(`ir35${SEPARATOR}outside`),
  /non[\s-]?ir35/,
  /(?:falls?|deemed)\s+outside/,
  NOT_CAUGHT,
];

const INSIDE: RegExp[] = [
  /inside\s+(?:of\s+)?(?:the\s+)?ir35/,
  new RegExp(`ir35${SEPARATOR}inside`),
  /(?:caught|covered)\s+by\s+(?:the\s+)?ir35/,
  /within\s+(?:the\s+)?ir35/,
];

const UNDECIDED =
  /ir35\s*(?:status|determination)?\s*[:-]?\s*(?:tbc|tbd|to be (?:confirmed|determined)|pending|being (?:determined|assessed))|determination\s*(?:tbc|tbd|to be confirmed)/;

const WEAK_INSIDE = /\b(?:umbrella|paye)\b/;
const WEAK_OUTSIDE =
  /\b(?:own|limited|ltd)\s+(?:company|co)\b|\bvia\s+(?:your\s+)?(?:own\s+)?ltd\b/;

const result = (value: Ir35, confidence: Ir35Confidence): Ir35Detection => ({ value, confidence });

/**
 * IR35 status from advert wording. Explicit statements are 'high'; PAYE/umbrella wording leans
 * inside ('medium'); "Ltd company" leans outside ('low'). Contradictory or undecided wording is
 * 'unknown' so the filter never wrongly rejects a job (SPEC §7.1: unknown passes).
 */
export function detectIr35(text: string): Ir35Detection {
  const t = normalise(text);
  const outside = OUTSIDE.some((re) => re.test(t));
  const inside = INSIDE.some((re) => re.test(t.replace(NOT_CAUGHT, ' ')));

  if (outside && inside) return result('unknown', 'low');
  if (outside) return result('outside', 'high');
  if (inside) return result('inside', 'high');
  if (UNDECIDED.test(t)) return result('unknown', 'low');

  const weakInside = WEAK_INSIDE.test(t);
  const weakOutside = WEAK_OUTSIDE.test(t);
  if (weakInside && weakOutside) return result('unknown', 'low');
  if (weakInside) return result('inside', 'medium');
  if (weakOutside) return result('outside', 'low');
  return result('unknown', 'none');
}
