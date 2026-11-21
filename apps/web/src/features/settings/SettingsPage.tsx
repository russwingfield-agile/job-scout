import type { Settings } from '@job-scout/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useAllSettings, useDeleteAllData, useUpdateSettings } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { TagInput } from '../../components/ui/TagInput.js';
import { useToast } from '../../components/ui/Toast.js';

/** The phrase the server expects before it deletes everything. */
export const DELETE_PHRASE = 'DELETE EVERYTHING';

const inputClass =
  'w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-sm';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
    </div>
  );
}

function ScansAndLimits({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [maxLlm, setMaxLlm] = useState(String(settings.budgets.maxLlmPerRun));
  const [prefilterMin, setPrefilterMin] = useState(String(settings.thresholds.prefilterMin));
  const [maxAge, setMaxAge] = useState(String(settings.ingest.maxAgeDays));
  const [weekdays, setWeekdays] = useState(settings.schedule['mon-fri']);
  const [saturday, setSaturday] = useState(settings.schedule.sat);
  const [sunday, setSunday] = useState(settings.schedule.sun);

  const save = () =>
    update
      .mutateAsync({
        budgets: { maxLlmPerRun: Number(maxLlm) },
        thresholds: { prefilterMin: Number(prefilterMin) },
        ingest: { maxAgeDays: Number(maxAge) },
        schedule: { 'mon-fri': weekdays, sat: saturday, sun: sunday },
      })
      .then(() => toast.push('success', 'Settings saved.'))
      .catch((err: unknown) =>
        toast.push(
          'error',
          err instanceof ApiError
            ? `${err.message} ${err.issues.map((i) => i.message).join('; ')}`
            : 'Could not save.',
        ),
      );

  return (
    <section
      aria-label="Scans and limits"
      className="grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h3 className="font-semibold">Scans and limits</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="max-llm"
          label="Jobs the AI assesses per scan"
          hint="More jobs use more of the daily AI allowance."
        >
          <input
            id="max-llm"
            type="number"
            min={0}
            className={inputClass}
            value={maxLlm}
            onChange={(e) => setMaxLlm(e.target.value)}
          />
        </Field>
        <Field
          id="prefilter-min"
          label="Minimum first-pass score"
          hint="Jobs below this are not sent to the AI (0–100)."
        >
          <input
            id="prefilter-min"
            type="number"
            min={0}
            max={100}
            className={inputClass}
            value={prefilterMin}
            onChange={(e) => setPrefilterMin(e.target.value)}
          />
        </Field>
        <Field
          id="max-age"
          label="Ignore adverts older than (days)"
          hint="Older jobs are noted but never fetched."
        >
          <input
            id="max-age"
            type="number"
            min={1}
            className={inputClass}
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Scan times are in {settings.schedule.timezone} time, as 24-hour HH:MM. A scan starts in the
        hour you list.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <TagInput
          label="Monday to Friday"
          values={weekdays}
          onChange={setWeekdays}
          placeholder="07:00"
        />
        <TagInput label="Saturday" values={saturday} onChange={setSaturday} placeholder="none" />
        <TagInput label="Sunday" values={sunday} onChange={setSunday} placeholder="17:00" />
      </div>
      <div>
        <Button variant="primary" loading={update.isPending} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </section>
  );
}

function Blocklist({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [employers, setEmployers] = useState(settings.blocklist.employers);
  const [agencies, setAgencies] = useState(settings.blocklist.agencies);
  const [keywords, setKeywords] = useState(settings.blocklist.keywords);

  return (
    <section
      aria-label="Blocklist"
      className="grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div>
        <h3 className="font-semibold">Blocklist</h3>
        <p className="text-sm text-[var(--muted)]">
          Jobs matching these are hidden from every search, and show under “Filtered out”.
        </p>
      </div>
      <TagInput label="Employers to avoid" values={employers} onChange={setEmployers} />
      <TagInput label="Agencies to avoid" values={agencies} onChange={setAgencies} />
      <TagInput label="Words to avoid in an advert" values={keywords} onChange={setKeywords} />
      <div>
        <Button
          variant="primary"
          loading={update.isPending}
          onClick={() =>
            update
              .mutateAsync({ blocklist: { employers, agencies, keywords } })
              .then(() => toast.push('success', 'Blocklist saved. It applies from the next scan.'))
              .catch(() => toast.push('error', 'Could not save the blocklist.'))
          }
        >
          Save blocklist
        </Button>
      </div>
    </section>
  );
}

function DangerZone() {
  const wipe = useDeleteAllData();
  const toast = useToast();
  const [phrase, setPhrase] = useState('');

  return (
    <section
      aria-label="Danger zone"
      className="grid gap-3 rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-4"
    >
      <h3 className="font-semibold text-[var(--danger)]">Danger zone</h3>
      <p className="text-sm">
        Delete all data removes every job, assessment, note, scan history, CV (including the
        uploaded files) and search profile. Your settings stay. This cannot be undone.
      </p>
      <label className="grid gap-1 text-sm">
        <span>
          Type <strong>{DELETE_PHRASE}</strong> to enable the button
        </span>
        <input className={inputClass} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
      </label>
      <div>
        <Button
          variant="danger"
          disabled={phrase !== DELETE_PHRASE}
          loading={wipe.isPending}
          onClick={() =>
            wipe
              .mutateAsync(phrase)
              .then((r) => {
                setPhrase('');
                toast.push('success', `Deleted ${r.jobs} jobs and ${r.cvs} CVs.`);
              })
              .catch((err: unknown) =>
                toast.push('error', err instanceof ApiError ? err.message : 'Could not delete.'),
              )
          }
        >
          Delete all data
        </Button>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const query = useAllSettings();
  return (
    <div className="grid max-w-4xl gap-4">
      <h2 className="text-xl font-semibold">Settings</h2>
      {query.isPending ? <p aria-busy="true">Loading…</p> : null}
      {query.isError ? (
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>Could not load your settings.</p>
          <Button className="mt-2" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <>
          <ScansAndLimits settings={query.data} />
          <Blocklist settings={query.data} />
        </>
      ) : null}
      <DangerZone />
    </div>
  );
}
