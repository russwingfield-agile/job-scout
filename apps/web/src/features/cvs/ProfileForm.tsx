import {
  type EmploymentType,
  type Ir35Preference,
  type SearchProfile,
  type UpdateSearchProfile,
  UpdateSearchProfileSchema,
  type WorkMode,
} from '@job-scout/shared';
import { type FormEvent, useId, useState } from 'react';
import { Button } from '../../components/ui/Button.js';
import { TagInput } from '../../components/ui/TagInput.js';

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'contract', label: 'Contract' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'temp', label: 'Temp' },
];
const IR35_OPTIONS: { value: Ir35Preference; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'prefer_outside', label: 'Prefer outside' },
  { value: 'outside_only', label: 'Outside only' },
];
const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On site' },
];

/** Number-field text → value: '' means "not set" (null); anything unparsable is NaN so it fails validation. */
const toNullableNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text);
const show = (n: number | null): string => (n === null ? '' : String(n));

type Errors = Partial<Record<string, string>>;

export type ProfileFormProps = {
  profile: SearchProfile;
  onSave: (values: UpdateSearchProfile) => void | Promise<void>;
  saving?: boolean;
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Editable search profile (SPEC §6.2). Validates with the same schema the server uses. */
export function ProfileForm({ profile, onSave, saving = false }: ProfileFormProps) {
  const uid = useId();
  const [jobTitles, setJobTitles] = useState(profile.jobTitles);
  const [mustKeywords, setMustKeywords] = useState(profile.mustKeywords);
  const [excludeKeywords, setExcludeKeywords] = useState(profile.excludeKeywords);
  const [locations, setLocations] = useState(profile.locations);
  const [radius, setRadius] = useState(String(profile.radiusMiles));
  const [employmentTypes, setEmploymentTypes] = useState(profile.employmentTypes);
  const [minDayRate, setMinDayRate] = useState(show(profile.minDayRate));
  const [minSalary, setMinSalary] = useState(show(profile.minSalary));
  const [ir35, setIr35] = useState(profile.ir35Preference);
  const [workModes, setWorkModes] = useState(profile.workModes);
  const [maxOnsiteDays, setMaxOnsiteDays] = useState(show(profile.maxOnsiteDays));
  const [active, setActive] = useState(profile.active);
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = UpdateSearchProfileSchema.safeParse({
      jobTitles,
      mustKeywords,
      excludeKeywords,
      locations,
      radiusMiles: radius.trim() === '' ? undefined : Number(radius),
      employmentTypes,
      minDayRate: toNullableNumber(minDayRate),
      minSalary: toNullableNumber(minSalary),
      ir35Preference: ir35,
      workModes,
      maxOnsiteDays: toNullableNumber(maxOnsiteDays),
      active,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await onSave(parsed.data);
  };

  const numberField = (
    name: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string,
  ) => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={`${uid}-${name}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[name] ? true : undefined}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
      />
      {errors[name] ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {errors[name]}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );

  const checkboxGroup = <T extends string>(
    legend: string,
    options: { value: T; label: string }[],
    selected: T[],
    set: (v: T[]) => void,
    error?: string,
  ) => (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => set(toggle(selected, o.value))}
            />
            {o.label}
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-4" aria-label="Search profile">
      <TagInput
        label="Job titles"
        values={jobTitles}
        onChange={setJobTitles}
        placeholder="e.g. Agile Coach"
        hint="Each title becomes a search on Reed."
        error={errors.jobTitles}
      />
      <TagInput
        label="Locations"
        values={locations}
        onChange={setLocations}
        placeholder="e.g. London"
        hint='"Remote" searches without a location.'
        error={errors.locations}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TagInput
          label="Must-have keywords"
          values={mustKeywords}
          onChange={setMustKeywords}
          placeholder="e.g. SAFe"
          error={errors.mustKeywords}
        />
        <TagInput
          label="Exclude keywords"
          values={excludeKeywords}
          onChange={setExcludeKeywords}
          placeholder="e.g. graduate"
          hint="Jobs containing these are hidden."
          error={errors.excludeKeywords}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {numberField('radius', 'Search radius (miles)', radius, setRadius)}
        {numberField(
          'minDayRate',
          'Minimum day rate (£)',
          minDayRate,
          setMinDayRate,
          'Contracts only; blank for none.',
        )}
        {numberField(
          'minSalary',
          'Minimum salary (£)',
          minSalary,
          setMinSalary,
          'Permanent only; blank for none.',
        )}
      </div>

      {checkboxGroup(
        'Employment types',
        EMPLOYMENT_TYPES,
        employmentTypes,
        setEmploymentTypes,
        errors.employmentTypes,
      )}

      <fieldset>
        <legend className="mb-1 text-sm font-medium">IR35</legend>
        <div className="flex flex-wrap gap-3">
          {IR35_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={`${uid}-ir35`}
                checked={ir35 === o.value}
                onChange={() => setIr35(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {checkboxGroup('Work mode', WORK_MODES, workModes, setWorkModes)}
        {numberField(
          'maxOnsiteDays',
          'Max days on site per week',
          maxOnsiteDays,
          setMaxOnsiteDays,
          'Blank for no limit.',
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Include this profile in searches
      </label>

      <div>
        <Button type="submit" variant="primary" loading={saving}>
          Save profile
        </Button>
      </div>
    </form>
  );
}
