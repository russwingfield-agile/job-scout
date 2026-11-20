import type { CvDetail, CvMutationResponse } from '@job-scout/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client.js';
import {
  useCv,
  useDeleteCv,
  useReanalyseCv,
  useUpdateCv,
  useUpdateProfile,
} from '../../api/queries.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { ProfileForm } from './ProfileForm.js';

const errorText = (err: unknown): string =>
  err instanceof ApiError ? err.message : 'Something went wrong.';

function Chips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
        {label}
      </h4>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item}>
            <Badge>{item}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type CvPanelProps = {
  cvId: string;
  warnings: string[];
  onWarnings: (cvId: string, warnings: string[]) => void;
  onDeleted: (cvId: string) => void;
};

/** One CV: summary, editable extracted text, and its search profile. */
export function CvPanel({ cvId, warnings, onWarnings, onDeleted }: CvPanelProps) {
  const query = useCv(cvId);
  if (query.isPending) return <p aria-busy="true">Loading CV…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
        <p>Could not load this CV. {errorText(query.error)}</p>
        <Button className="mt-2" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <CvPanelBody
      cv={query.data}
      warnings={warnings}
      onWarnings={onWarnings}
      onDeleted={onDeleted}
    />
  );
}

function CvPanelBody({
  cv,
  warnings,
  onWarnings,
  onDeleted,
}: { cv: CvDetail } & Omit<CvPanelProps, 'cvId'>) {
  const toast = useToast();
  const update = useUpdateCv(cv.id);
  const reanalyse = useReanalyseCv(cv.id);
  const remove = useDeleteCv();
  const saveProfile = useUpdateProfile(cv.profile?.id ?? '', cv.id);

  const [label, setLabel] = useState(cv.label);
  const [text, setText] = useState(cv.textMd);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Pick up server-side changes (after save, re-analyse, or switching CVs).
  useEffect(() => setLabel(cv.label), [cv.label]);
  useEffect(() => setText(cv.textMd), [cv.textMd]);

  const handle = (result: CvMutationResponse, success: string) => {
    onWarnings(cv.id, result.warnings);
    toast.push('success', success);
    for (const w of result.warnings) toast.push('warning', w);
  };

  const run = (mutation: Promise<CvMutationResponse>, success: string) =>
    mutation
      .then((r) => handle(r, success))
      .catch((err: unknown) => toast.push('error', errorText(err)));

  const textChanged = text !== cv.textMd;
  const labelChanged = label.trim() !== cv.label && label.trim() !== '';
  const { summary } = cv;

  return (
    <section aria-label={`CV: ${cv.label}`} className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="cv-label" className="mb-1 block text-sm font-medium">
            Label
          </label>
          <input
            id="cv-label"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          />
        </div>
        <Button
          disabled={!labelChanged}
          loading={update.isPending && labelChanged}
          onClick={() => void run(update.mutateAsync({ label: label.trim() }), 'Label saved.')}
        >
          Save label
        </Button>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={cv.active}
            disabled={update.isPending}
            onChange={(e) =>
              void run(
                update.mutateAsync({ active: e.target.checked }),
                e.target.checked ? 'CV activated.' : 'CV deactivated.',
              )
            }
          />
          Active
        </label>
      </div>

      {warnings.length > 0 ? (
        <div role="status" className="rounded-md border border-[var(--warning)] p-3 text-sm">
          <p className="font-medium">Needs attention</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="font-semibold">Summary</h3>
        {summary ? (
          <>
            <p>{summary.headline}</p>
            <p className="text-sm text-[var(--muted)]">
              {summary.seniority} · {summary.yearsExperience} years experience
            </p>
            <Chips label="Skills" items={summary.skills} />
            <Chips label="Sectors" items={summary.sectors} />
            <Chips label="Suggested titles" items={summary.suggestedTitles} />
            <Chips label="Suggested keywords" items={summary.suggestedKeywords} />
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No summary yet. Check the text below, then click Re-analyse.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <label htmlFor="cv-text" className="text-sm font-medium">
          Extracted text
        </label>
        <p className="text-xs text-[var(--muted)]">
          Parsing is never perfect. Fix anything that looks wrong, then save — saving re-analyses
          the CV.
        </p>
        <textarea
          id="cv-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!textChanged}
            loading={update.isPending && textChanged}
            onClick={() =>
              void run(update.mutateAsync({ textMd: text }), 'Text saved and re-analysed.')
            }
          >
            Save text
          </Button>
          <Button
            loading={reanalyse.isPending}
            disabled={textChanged}
            title={textChanged ? 'Save your text changes first' : undefined}
            onClick={() => void run(reanalyse.mutateAsync(), 'CV re-analysed.')}
          >
            Re-analyse
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="font-semibold">Search profile</h3>
        {cv.profile ? (
          <ProfileForm
            key={cv.profile.updatedAt}
            profile={cv.profile}
            saving={saveProfile.isPending}
            onSave={(values) =>
              saveProfile
                .mutateAsync(values)
                .then(() => toast.push('success', 'Profile saved.'))
                .catch((err: unknown) => toast.push('error', errorText(err)))
            }
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No profile yet. Click Re-analyse to create one from this CV.
          </p>
        )}
      </div>

      <div>
        {confirmingDelete ? (
          <div
            role="alertdialog"
            aria-label="Confirm delete"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span>Delete this CV, its file and its search profile? This cannot be undone.</span>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                void remove
                  .mutateAsync(cv.id)
                  .then(() => {
                    toast.push('success', 'CV deleted.');
                    onDeleted(cv.id);
                  })
                  .catch((err: unknown) => toast.push('error', errorText(err)))
              }
            >
              Yes, delete
            </Button>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete CV
          </Button>
        )}
      </div>
    </section>
  );
}
