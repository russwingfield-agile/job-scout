export type Seniority = 'junior' | 'senior' | 'lead' | 'principal';

export type NormalisedTitle = { normalised: string; seniority: Seniority | null };

const SENIORITY_WORDS: Record<string, Seniority> = {
  junior: 'junior',
  jr: 'junior',
  senior: 'senior',
  sr: 'senior',
  principal: 'principal',
};

/** Words that describe the engagement, not the role. */
const NOISE_WORDS = new Set([
  'contract',
  'contractor',
  'permanent',
  'perm',
  'temp',
  'temporary',
  'urgent',
  'asap',
  'remote',
  'hybrid',
  'inside',
  'outside',
  'ir35',
]);

const CITIES = [
  'london',
  'manchester',
  'birmingham',
  'leeds',
  'glasgow',
  'edinburgh',
  'bristol',
  'cardiff',
  'belfast',
  'liverpool',
  'newcastle',
  'sheffield',
  'nottingham',
  'reading',
  'milton keynes',
  'cambridge',
  'oxford',
  'southampton',
  'leicester',
  'aberdeen',
];

const SEGMENT_SPLIT = /\s+[-–—|@]\s+|\s*\|\s*|,/;
const PARENTHETICAL = /\([^)]*\)|\[[^\]]*\]/g;
const TAIL_SEGMENT = new RegExp(
  String.raw`\d|£|\b(?:contract|permanent|temp|remote|hybrid|inside|outside|ir35|asap|urgent|day rate)\b|\b(?:${CITIES.join('|')})\b`,
);

/**
 * Canonical form of a job title for duplicate detection (plan M2.7): lower-case, parentheticals and
 * "- London"/"- £600pd" tails removed, engagement words dropped, seniority split into its own field.
 * "Lead" counts as seniority only as the first word ("Lead Agile Coach", not "Delivery Lead").
 */
export function normaliseTitle(title: string): NormalisedTitle {
  const segments = title.toLowerCase().replace(PARENTHETICAL, ' ').split(SEGMENT_SPLIT);
  // split() always yields at least one segment; later ones survive only if they are not tails.
  const kept = segments.filter((segment, i) => i === 0 || !TAIL_SEGMENT.test(segment));

  const tokens = kept
    .join(' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let seniority: Seniority | null = null;
  const roleTokens: string[] = [];
  for (const [i, token] of tokens.entries()) {
    const level = SENIORITY_WORDS[token] ?? (i === 0 && token === 'lead' ? 'lead' : undefined);
    if (level) {
      seniority ??= level;
    } else if (!NOISE_WORDS.has(token)) {
      roleTokens.push(token);
    }
  }
  return { normalised: roleTokens.join(' '), seniority };
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** 1 − edit distance / longer length, in [0, 1]. Callers guarantee at least one string is non-empty. */
const similarity = (a: string, b: string): number =>
  1 - levenshtein(a, b) / Math.max(a.length, b.length);

/**
 * Token-set ratio (the fuzzywuzzy method) in [0, 1]: word order and repeats are ignored, and a
 * title whose words are a subset of the other's scores 1. Pass already-normalised titles.
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const sorted = (words: Iterable<string>) => [...words].sort();
  const common = sorted([...tokensA].filter((t) => tokensB.has(t)));
  const onlyA = sorted([...tokensA].filter((t) => !tokensB.has(t)));
  const onlyB = sorted([...tokensB].filter((t) => !tokensA.has(t)));

  const base = common.join(' ');
  const left = [...common, ...onlyA].join(' ');
  const right = [...common, ...onlyB].join(' ');
  return Math.max(similarity(base, left), similarity(base, right), similarity(left, right));
}
