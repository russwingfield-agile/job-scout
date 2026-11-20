import type { EmploymentType, NormalisedJob, ReedJobDetails } from '@job-scout/shared';
import { detectContractLengthMonths } from './parse/contractLength.js';
import { parseSourceDate } from './parse/date.js';
import { detectEmploymentType } from './parse/employmentType.js';
import { detectIr35 } from './parse/ir35.js';
import { parsePay } from './parse/pay.js';
import { htmlToText } from './parse/text.js';
import { detectWorkMode } from './parse/workMode.js';

export type NormaliseContext = {
  /** Types the originating search asked for; breaks ties when the advert does not say. */
  profileEmploymentTypes: EmploymentType[];
  /** Fallback posted date when the source gives none, injected to keep this function pure. */
  now: Date;
};

/** Employer names that clearly belong to a recruiter. `null` (unknown) otherwise, never `false`. */
const AGENCY_NAME =
  /recruit|staffing|resourcing|personnel|headhunt|talent|executive search|\bagency\b/i;

const READ_ONLY_TEXT_CHARS = 2_000;

/** Reed's `salary` text, with `salaryType` ("per day") appended only if the text lacks it. */
function salaryTextOf(raw: ReedJobDetails): string {
  const salary = raw.salary ?? '';
  const type = raw.salaryType ?? '';
  const alreadyStated = salary.toLowerCase().includes(type.toLowerCase());
  return type && !alreadyStated ? `${salary} ${type}`.trim() : salary;
}

/** Reed job details → the source-agnostic shape everything downstream uses (SPEC §4.4). */
export function normaliseReedJob(raw: ReedJobDetails, ctx: NormaliseContext): NormalisedJob {
  const descriptionText = htmlToText(raw.jobDescription);
  const salaryText = salaryTextOf(raw);

  const employmentType = detectEmploymentType({
    contractType: raw.contractType,
    jobType: raw.jobType,
    text: `${raw.jobTitle}\n${salaryText}\n${descriptionText.slice(0, READ_ONLY_TEXT_CHARS)}`,
    profileEmploymentTypes: ctx.profileEmploymentTypes,
  });

  // Structured salary text first; fall back to an explicit-period amount quoted in the advert.
  const fromSalary = parsePay(salaryText, {
    employmentType,
    minHint: raw.minimumSalary,
    maxHint: raw.maximumSalary,
  });
  const fromAdvert = parsePay(descriptionText, { employmentType, requireCurrency: true });
  const pay =
    fromSalary.confidence === 'none' && fromAdvert.confidence === 'high' ? fromAdvert : fromSalary;

  const isEngagement = employmentType !== 'permanent';
  const fullText = `${raw.jobTitle}\n${salaryText}\n${descriptionText}`;
  const workMode = detectWorkMode(`${raw.jobTitle}\n${descriptionText}`, {
    location: raw.locationName,
  });
  const contractLength = isEngagement ? detectContractLengthMonths(fullText) : null;
  const expiresAt = parseSourceDate(raw.expirationDate);
  const applicationsCount = raw.applicationCount ?? raw.applications;

  return {
    source: 'reed',
    sourceJobId: String(raw.jobId),
    url: raw.jobUrl ?? `https://www.reed.co.uk/jobs/${raw.jobId}`,
    ...(raw.externalUrl ? { externalApplyUrl: raw.externalUrl } : {}),
    title: raw.jobTitle,
    employerName: raw.employerName,
    isAgency: AGENCY_NAME.test(raw.employerName) ? true : null,
    location: raw.locationName,
    workMode: workMode.mode,
    ...(workMode.onsiteDaysPerWeek === undefined
      ? {}
      : { onsiteDaysPerWeek: workMode.onsiteDaysPerWeek }),
    employmentType,
    ...(salaryText ? { salaryText } : {}),
    ...(pay.min === null ? {} : { payMin: pay.min }),
    ...(pay.max === null ? {} : { payMax: pay.max }),
    payPeriod: pay.period,
    currency: 'GBP',
    ...(isEngagement ? { ir35: detectIr35(fullText).value } : {}),
    ...(contractLength === null ? {} : { contractLengthMonths: contractLength }),
    postedAt: parseSourceDate(raw.datePosted ?? raw.date) ?? ctx.now.toISOString(),
    ...(expiresAt === null ? {} : { expiresAt }),
    descriptionHtml: raw.jobDescription,
    descriptionText,
    ...(applicationsCount === null || applicationsCount === undefined ? {} : { applicationsCount }),
  };
}
