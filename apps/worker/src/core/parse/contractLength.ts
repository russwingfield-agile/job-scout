const MONTHS_PER_YEAR = 12;
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const NOT_A_NOTICE = String.raw`(?!\s*(?:notice|probation|break|gap))`;

// "6 month contract", "12 months initial", "3-month rolling"
const NUMBER_THEN_KEYWORD = new RegExp(
  String.raw`${NUM}\s*[- ]?\s*(?:month|mth)s?${NOT_A_NOTICE}\s*(?:\+\s*)?(?:initial\s+|rolling\s+|fixed[- ]term\s+)?(?:contract|assignment|engagement|term|initial|rolling|extension|duration)`,
);
// "contract duration: 6 months", "initial 3 months", "length of contract 12 months"
const KEYWORD_THEN_NUMBER = new RegExp(
  String.raw`(?:contract|duration|length|term|initial|assignment)\s*(?:length|duration|term)?\s*(?:of|:|-|is)?\s*(?:initially\s+)?${NUM}\s*[- ]?\s*(month|mth|year|yr)s?`,
);
// "1 year contract", "2-year fixed term contract"
const YEARS_CONTRACT = new RegExp(
  String.raw`${NUM}\s*[- ]?\s*(?:year|yr)s?\s*(?:fixed[- ]term\s+)?contract`,
);

const capture = (m: RegExpExecArray, i: number): string => m[i] as string;

/** Contract length in months from advert wording, or null. Only call for contract/temp roles. */
export function detectContractLengthMonths(text: string): number | null {
  const t = text.toLowerCase().replace(/[‐-―−]/g, '-');

  const direct = NUMBER_THEN_KEYWORD.exec(t);
  if (direct) return Number(capture(direct, 1));

  const labelled = KEYWORD_THEN_NUMBER.exec(t);
  if (labelled) {
    const n = Number(capture(labelled, 1));
    return capture(labelled, 2).startsWith('y') ? n * MONTHS_PER_YEAR : n;
  }

  const years = YEARS_CONTRACT.exec(t);
  return years ? Number(capture(years, 1)) * MONTHS_PER_YEAR : null;
}
