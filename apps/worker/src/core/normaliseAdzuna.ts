import type { AdzunaResult, NormalisedJob } from '@job-scout/shared';
import { AGENCY_NAME, type NormaliseContext } from './normalise.js';
import { detectContractLengthMonths } from './parse/contractLength.js';
import { parseSourceDate } from './parse/date.js';
import { detectEmploymentType } from './parse/employmentType.js';
import { detectIr35 } from './parse/ir35.js';
import { parsePay } from './parse/pay.js';
import { htmlToText } from './parse/text.js';
import { detectWorkMode } from './parse/workMode.js';

/**
 * A "salary" under this on a contract is a day rate, not a yearly figure. ASSUMPTION: Adzuna
 * reports pay as stated, so a contract paying £500 shows 500, not 110,000; verify with real data.
 */
const MAX_DAY_RATE_FIGURE = 2_000;

const isPredicted = (v: AdzunaResult['salary_is_predicted']): boolean =>
  v === true || v === 1 || v === '1' || v === 'true';

/** Adzuna search hit → the source-agnostic shape. The description is only an excerpt. */
export function normaliseAdzunaJob(raw: AdzunaResult, ctx: NormaliseContext): NormalisedJob {
  const descriptionText = htmlToText(raw.description ?? '');
  const employerName = raw.company?.display_name ?? 'Unknown employer';
  const location = raw.location?.display_name ?? raw.location?.area?.join(', ') ?? '';
  const text = `${raw.title}\n${descriptionText}`;

  const employmentType = detectEmploymentType({
    contractType: raw.contract_type ?? null,
    jobType: raw.contract_time ?? null,
    text,
    profileEmploymentTypes: ctx.profileEmploymentTypes,
  });

  // Adzuna's own pay is used only when the advert stated it (not when Adzuna guessed).
  const stated = !isPredicted(raw.salary_is_predicted);
  const min = stated ? (raw.salary_min ?? null) : null;
  const max = stated ? (raw.salary_max ?? null) : null;
  const top = max ?? min;
  const isEngagement = employmentType !== 'permanent';
  const fromAdzuna =
    top === null
      ? null
      : {
          min: min ?? top,
          max: max ?? top,
          period: isEngagement && top < MAX_DAY_RATE_FIGURE ? ('day' as const) : ('year' as const),
        };
  const fromText = parsePay(descriptionText, { employmentType, requireCurrency: true });
  const pay =
    fromAdzuna ??
    (fromText.confidence === 'high'
      ? { min: fromText.min, max: fromText.max, period: fromText.period }
      : { min: null, max: null, period: 'unknown' as const });

  const workMode = detectWorkMode(text, { location });
  const contractLength = isEngagement ? detectContractLengthMonths(text) : null;

  return {
    source: 'adzuna',
    sourceJobId: String(raw.id),
    url: raw.redirect_url,
    title: raw.title,
    employerName,
    isAgency: AGENCY_NAME.test(employerName) ? true : null,
    location,
    workMode: workMode.mode,
    ...(workMode.onsiteDaysPerWeek === undefined
      ? {}
      : { onsiteDaysPerWeek: workMode.onsiteDaysPerWeek }),
    employmentType,
    ...(pay.min === null ? {} : { payMin: pay.min }),
    ...(pay.max === null ? {} : { payMax: pay.max }),
    payPeriod: pay.period,
    currency: 'GBP',
    ...(isEngagement ? { ir35: detectIr35(text).value } : {}),
    ...(contractLength === null ? {} : { contractLengthMonths: contractLength }),
    postedAt: parseSourceDate(raw.created) ?? ctx.now.toISOString(),
    descriptionHtml: raw.description ?? '',
    descriptionText,
  };
}
