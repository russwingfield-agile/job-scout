import type { EmploymentType } from '@job-scout/shared';

export type EmploymentTypeInput = {
  /** Reed `contractType`, e.g. "Permanent" | "Contract" | "Temporary". */
  contractType?: string | null | undefined;
  /** Reed `jobType`, e.g. "Full-time" (occasionally "Contract"). */
  jobType?: string | null | undefined;
  /** Title / salary / description text, used when the structured fields say nothing. */
  text?: string | undefined;
  /** If the query asked for exactly one type, a last-resort tiebreak. */
  profileEmploymentTypes?: EmploymentType[] | undefined;
};

type Known = Exclude<EmploymentType, 'unknown'>;

function fromLabel(label: string | null | undefined): EmploymentType {
  const l = (label ?? '').toLowerCase();
  if (l.includes('perm')) return 'permanent';
  if (l.includes('contract') || l.includes('fixed')) return 'contract';
  if (l.includes('temp')) return 'temp';
  return 'unknown';
}

// "permanent contract" / "contract of employment" describe perm roles; they must not read as contract.
const PERMANENT_CONTRACT = /permanent\s+contract/g;
const EMPLOYMENT_CONTRACT_WORDING = /employment\s+contract|contract\s+of\s+employment|contractual/g;

const TEXT_SIGNALS: Record<Known, RegExp> = {
  contract:
    /\bcontract(?:or)?\b|day\s*rate|\bper\s*day\b|\b(?:inside|outside)\s*ir[\s-]?35\b|fixed[- ]term|\binterim\b/,
  permanent: /\bpermanent\b|\bperm\b|\bper\s*annum\b/,
  temp: /\btemp(?:orary)?\b/,
};

function fromText(text: string): EmploymentType {
  const t = text
    .toLowerCase()
    .replace(PERMANENT_CONTRACT, 'permanent')
    .replace(EMPLOYMENT_CONTRACT_WORDING, ' ');
  const matches = (Object.keys(TEXT_SIGNALS) as Known[]).filter((k) => TEXT_SIGNALS[k].test(t));
  return matches.length === 1 ? (matches[0] as Known) : 'unknown';
}

/** Structured Reed fields first, then advert wording, then the profile's single requested type. */
export function detectEmploymentType(input: EmploymentTypeInput): EmploymentType {
  const structured = [fromLabel(input.contractType), fromLabel(input.jobType)].find(
    (t) => t !== 'unknown',
  );
  if (structured) return structured;

  const fromWording = fromText(input.text ?? '');
  if (fromWording !== 'unknown') return fromWording;

  const requested = input.profileEmploymentTypes ?? [];
  return requested.length === 1 ? (requested[0] as EmploymentType) : 'unknown';
}
