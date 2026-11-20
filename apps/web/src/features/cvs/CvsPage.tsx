import { useState } from 'react';
import { useCvs, useSettings } from '../../api/queries.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { CvPanel } from './CvPanel.js';
import { CvUploader } from './CvUploader.js';

/** Used until the settings request returns (and if it fails). */
const FALLBACK_MAX_ACTIVE = 4;
const FALLBACK_MAX_BYTES = 5 * 1024 * 1024;

function Skeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading CVs"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-lg bg-[var(--surface-2)]" />
      ))}
    </div>
  );
}

export function CvsPage() {
  const cvs = useCvs();
  const settings = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Record<string, string[]>>({});

  const maxActive = settings.data?.cvs.maxActive ?? FALLBACK_MAX_ACTIVE;
  const maxBytes = settings.data?.cvs.maxUploadBytes ?? FALLBACK_MAX_BYTES;

  if (cvs.isPending) {
    return (
      <div className="grid gap-4">
        <h2 className="text-xl font-semibold">CVs &amp; search profiles</h2>
        <Skeleton />
      </div>
    );
  }
  if (cvs.isError) {
    return (
      <div className="grid gap-3">
        <h2 className="text-xl font-semibold">CVs &amp; search profiles</h2>
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>Could not load your CVs.</p>
          <Button className="mt-2" onClick={() => void cvs.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const list = cvs.data;
  const activeCount = list.filter((cv) => cv.active).length;
  const current = list.find((cv) => cv.id === selected) ?? list[0];
  const full = activeCount >= maxActive;

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-semibold">CVs &amp; search profiles</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {activeCount} of {maxActive} active CVs. Each CV gets its own search profile, pre-filled
          from its summary.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((cv) => (
          <button
            key={cv.id}
            type="button"
            onClick={() => setSelected(cv.id)}
            aria-pressed={cv.id === current?.id}
            className={`rounded-lg border bg-[var(--surface)] p-3 text-left text-sm ${
              cv.id === current?.id
                ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                : 'border-[var(--border)]'
            }`}
          >
            <span className="flex items-start justify-between gap-2">
              <strong className="break-words">{cv.label}</strong>
              <Badge tone={cv.active ? 'success' : 'neutral'}>
                {cv.active ? 'Active' : 'Inactive'}
              </Badge>
            </span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {cv.filename ?? 'No file name'}
            </span>
            <span className="mt-2 block text-xs">
              {cv.summary?.headline ?? 'Not summarised yet'}
            </span>
          </button>
        ))}
        {full ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
            All {maxActive} active slots are in use. Deactivate or delete a CV to add another.
          </p>
        ) : (
          <CvUploader
            maxBytes={maxBytes}
            onUploaded={(result) => {
              setSelected(result.cv.id);
              setWarnings((w) => ({ ...w, [result.cv.id]: result.warnings }));
            }}
          />
        )}
      </div>

      {list.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          No CVs yet. Upload your first one above — Job Scout reads it, summarises it, and pre-fills
          a search profile for you to confirm.
        </p>
      ) : current ? (
        <CvPanel
          key={current.id}
          cvId={current.id}
          warnings={warnings[current.id] ?? []}
          onWarnings={(id, w) => setWarnings((all) => ({ ...all, [id]: w }))}
          onDeleted={(id) => {
            setSelected(null);
            setWarnings((all) => {
              const { [id]: _removed, ...rest } = all;
              return rest;
            });
          }}
        />
      ) : null}
    </div>
  );
}
