import type { EmploymentType, PayPeriod } from '@job-scout/shared';

export type PayConfidence = 'high' | 'medium' | 'low' | 'none';

export type PayParse = {
  min: number | null;
  max: number | null;
  period: PayPeriod;
  confidence: PayConfidence;
};

export type PayHints = {
  employmentType?: EmploymentType | undefined;
  /** Structured min/max from the source (e.g. Reed minimumSalary); used only if the text has no amount. */
  minHint?: number | null | undefined;
  maxHint?: number | null | undefined;
  /** Accept only amounts with a £/GBP sign or k suffix — for scanning free-text descriptions. */
  requireCurrency?: boolean | undefined;
};

type KnownPeriod = Exclude<PayPeriod, 'unknown'>;

// SPEC §4.4 magnitude heuristics for amounts that state no period. These are parser constants,
// not tuning knobs: they decide how to *read* a number, not how to rank a job.
const ANNUAL_FROM = 10_000;
const DAY_RATE_BELOW = 2_000;
const HOURLY_BELOW = 100;
/** "80-95k": a bare number under this next to a k-suffixed one is read as thousands too. */
const K_PROPAGATE_BELOW = 1_000;

// Period vocabulary. Short forms (pd, ph, pa) must work glued to a digit ("£550pd"), so they use
// a letter lookbehind instead of \b.
const DAY = String.raw`(?:per\s*day|\/\s*day|\/\s*d(?![a-z])|a\s+day|daily|day\s*rate|per\s*diem|(?<![a-z])p\.?\/?d(?![a-z]))`;
const HOUR = String.raw`(?:per\s*h(?:ou)?rs?|\/\s*h(?:ou)?r|an\s+hour|hourly|(?<![a-z])p\.?\/?h(?![a-z]))`;
const YEAR = String.raw`(?:per\s*(?:annum|year|yr)|\/\s*(?:annum|year|yr)|a\s+year|annual(?:ly)?|yearly|(?<![a-z])p\.?\/?a(?![a-z]))`;

const PERIODS: { period: KnownPeriod; anywhere: RegExp; leading: RegExp }[] = [
  { period: 'day', src: DAY },
  { period: 'hour', src: HOUR },
  { period: 'year', src: YEAR },
].map(({ period, src }) => ({
  period: period as KnownPeriod,
  anywhere: new RegExp(src),
  leading: new RegExp(String.raw`^\s*${src}`),
}));

// [currency] number [k]. The lookbehind stops us matching inside "ir35", "1,234" or "£1.5".
const AMOUNT =
  /(?<![a-z\d.,£])(£|gbp)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k(?![a-z]))?/g;
const RANGE_CONNECTOR = /^\s*(?:-|to|and)\s*$/;
const UP_TO = /(?:up\s*to|upto|max(?:imum)?|capped\s+at)\s*$/;

type Amount = { start: number; end: number; value: number; hasK: boolean; currencyish: boolean };
type Candidate = { a: Amount; partner: Amount | undefined; period: PayPeriod; upTo: boolean };

/** A capture group that is known to participate in the match. */
const group = (m: RegExpExecArray, i: number): string => m[i] as string;

const noPay = (): PayParse => ({ min: null, max: null, period: 'unknown', confidence: 'none' });

const round2 = (n: number): number => Math.round(n * 100) / 100;

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\bir[\s-]?35\b/g, 'ir35');

function findAmounts(text: string): Amount[] {
  return [...text.matchAll(AMOUNT)]
    .map((m) => {
      const hasK = m[3] !== undefined;
      return {
        start: m.index,
        end: m.index + m[0].length,
        value: Number(group(m, 2).replaceAll(',', '')),
        hasK,
        currencyish: m[1] !== undefined || hasK,
      };
    })
    .filter((a) => a.value > 0);
}

/** The period whose keyword appears earliest in `s`, or 'unknown'. */
function findPeriod(s: string): PayPeriod {
  let best: PayPeriod = 'unknown';
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const { period, anywhere } of PERIODS) {
    const m = anywhere.exec(s);
    if (m && m.index < bestIndex) {
      best = period;
      bestIndex = m.index;
    }
  }
  return best;
}

/** The period keyword that starts `s` (after optional whitespace), or 'unknown'. */
function findLeadingPeriod(s: string): PayPeriod {
  return PERIODS.find(({ leading }) => leading.test(s))?.period ?? 'unknown';
}

/**
 * First amount (or "a - b" range) that reads as pay. Bare numbers ("2 days a week") only count when
 * a period keyword follows them directly; £/k amounts may find their period nearby.
 */
function findCandidate(text: string, strict: boolean): Candidate | null {
  const amounts = findAmounts(text);
  for (const [i, a] of amounts.entries()) {
    const next = amounts[i + 1];
    const partner = next && RANGE_CONNECTOR.test(text.slice(a.end, next.start)) ? next : undefined;
    const last = partner ?? a;
    const currencyish = a.currencyish || last.currencyish;
    if (strict && !currencyish) continue;

    const period = currencyish
      ? findPeriod(text.slice(Math.max(0, a.start - 16), last.end + 25))
      : findLeadingPeriod(text.slice(last.end));
    if (!currencyish && period === 'unknown') continue;

    const upTo =
      partner === undefined && UP_TO.test(text.slice(Math.max(0, a.start - 14), a.start));
    return { a, partner, period, upTo };
  }
  return null;
}

const scaled = (value: number, thousands: boolean): number =>
  round2(thousands ? value * 1000 : value);

function toRange({ a, partner, upTo }: Candidate): { min: number | null; max: number | null } {
  if (!partner) {
    const v = scaled(a.value, a.hasK);
    return upTo ? { min: null, max: v } : { min: v, max: v };
  }
  const aThousands = a.hasK || (partner.hasK && a.value < K_PROPAGATE_BELOW);
  const bThousands = partner.hasK || (a.hasK && partner.value < K_PROPAGATE_BELOW);
  const x = scaled(a.value, aThousands);
  const y = scaled(partner.value, bThousands);
  return { min: Math.min(x, y), max: Math.max(x, y) };
}

/** Guess the period of an amount that states none, from its size and the employment type. */
export function inferPeriod(
  value: number,
  employmentType: EmploymentType | undefined,
): { period: PayPeriod; confidence: PayConfidence } {
  if (value >= ANNUAL_FROM) return { period: 'year', confidence: 'medium' };
  if (value >= DAY_RATE_BELOW || employmentType === 'permanent') {
    return { period: 'unknown', confidence: 'low' };
  }
  return { period: value < HOURLY_BELOW ? 'hour' : 'day', confidence: 'medium' };
}

function withInferredPeriod(
  min: number | null,
  max: number | null,
  employmentType: EmploymentType | undefined,
): PayParse {
  const { period, confidence } = inferPeriod(Math.max(min ?? 0, max ?? 0), employmentType);
  return { min, max, period, confidence };
}

const positive = (n: number | null | undefined): number | null =>
  n !== undefined && n !== null && n > 0 ? n : null;

function fromHints(hints: PayHints): PayParse {
  const min = positive(hints.minHint);
  const max = positive(hints.maxHint);
  if (min === null && max === null) return noPay();
  return withInferredPeriod(min, max, hints.employmentType);
}

/**
 * Parse UK pay from free text ("£550 - £650 per day", "£80k-£95k + bonus", "£45ph", "up to £700 p/d").
 * Never throws: text with no amount ("Competitive", "DOE") yields confidence 'none'.
 *
 * Confidence: 'high' = amount with an explicit period; 'medium' = period inferred from magnitude;
 * 'low' = amount found but period unknowable; 'none' = no amount.
 */
export function parsePay(rawText: string, hints: PayHints = {}): PayParse {
  const candidate = findCandidate(normalise(rawText), hints.requireCurrency === true);
  if (!candidate) return fromHints(hints);

  const { min, max } = toRange(candidate);
  if (candidate.period !== 'unknown') {
    return { min, max, period: candidate.period, confidence: 'high' };
  }
  return withInferredPeriod(min, max, hints.employmentType);
}

export type WorkingTime = { workingDaysPerYear: number; hoursPerDay: number };

/** Convert a day/hour/year rate to a yearly figure so contract and perm sit on one axis. */
export function annualise(
  pay: Pick<PayParse, 'min' | 'max' | 'period'>,
  working: WorkingTime,
): { min: number | null; max: number | null } {
  const factors: Record<PayPeriod, number | null> = {
    day: working.workingDaysPerYear,
    hour: working.workingDaysPerYear * working.hoursPerDay,
    year: 1,
    unknown: null,
  };
  const factor = factors[pay.period];
  if (factor === null) return { min: null, max: null };
  const apply = (n: number | null) => (n === null ? null : Math.round(n * factor));
  return { min: apply(pay.min), max: apply(pay.max) };
}

const UNIT: Record<PayPeriod, string> = { day: '/day', hour: '/hr', year: '', unknown: '' };

const money = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toFixed(2);

/** "£600/day", "£550-£650/day", "£85k", "up to £700/day", "Not stated". */
export function formatPay(pay: Pick<PayParse, 'min' | 'max' | 'period'>): string {
  const { min, max, period } = pay;
  const unit = UNIT[period];
  const fmt = (n: number): string =>
    period === 'year' && n >= 1000 ? `£${Math.round(n / 100) / 10}k` : `£${money(n)}`;

  if (min === null && max === null) return 'Not stated';
  if (min === null) return `up to ${fmt(max as number)}${unit}`;
  if (max === null) return `from ${fmt(min)}${unit}`;
  if (min === max) return `${fmt(min)}${unit}`;
  return `${fmt(min)}-${fmt(max)}${unit}`;
}
