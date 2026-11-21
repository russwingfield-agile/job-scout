import type { CoverNote, CoverNoteKind, CoverNoteTone } from '@job-scout/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useCoverNotes, useCvs, useGenerateCoverNote } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { formatStarted } from '../../lib/format.js';

const KINDS: { value: CoverNoteKind; label: string }[] = [
  { value: 'cover_note', label: 'Cover note (up to 200 words)' },
  { value: 'recruiter_message', label: 'Recruiter message (up to 90 words)' },
];
const TONES: { value: CoverNoteTone; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'warm', label: 'Warm' },
  { value: 'formal', label: 'Formal' },
];

const selectClass = 'rounded-md border border-[var(--border)] bg-[var(--surface)] p-2';

/** Draft, edit and copy a cover note or recruiter message. Earlier drafts are kept below. */
export function CoverNotePanel({
  groupId,
  defaultCvId,
}: {
  groupId: string;
  defaultCvId: string | null;
}) {
  const cvs = useCvs();
  const notes = useCoverNotes(groupId);
  const generate = useGenerateCoverNote(groupId);
  const toast = useToast();

  const [cvId, setCvId] = useState(defaultCvId ?? '');
  const [kind, setKind] = useState<CoverNoteKind>('cover_note');
  const [tone, setTone] = useState<CoverNoteTone>('concise');
  const [draft, setDraft] = useState('');

  const activeCvs = (cvs.data ?? []).filter((c) => c.active);
  const history = notes.data ?? [];

  const run = () =>
    generate
      .mutateAsync({ ...(cvId ? { cvId } : {}), kind, tone })
      .then((note) => setDraft(note.text))
      .catch((err: unknown) =>
        toast.push('error', err instanceof ApiError ? err.message : 'Could not write a draft.'),
      );

  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.push('success', 'Copied to the clipboard.'))
      .catch(() => toast.push('error', 'Could not copy. Select the text and copy it by hand.'));

  const words = draft.split(/\s+/).filter(Boolean).length;

  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1">
          Write from
          <select className={selectClass} value={cvId} onChange={(e) => setCvId(e.target.value)}>
            <option value="">Best matching CV</option>
            {activeCvs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          What to write
          <select
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as CoverNoteKind)}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Tone
          <select
            className={selectClass}
            value={tone}
            onChange={(e) => setTone(e.target.value as CoverNoteTone)}
          >
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={generate.isPending} onClick={() => void run()}>
          {draft ? 'Write another draft' : 'Write a draft'}
        </Button>
      </div>

      {draft ? (
        <div>
          <label htmlFor="cover-draft" className="mb-1 block font-semibold">
            Draft (you can edit it)
          </label>
          <textarea
            id="cover-draft"
            rows={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-[var(--muted)]">{words} words</span>
            <Button onClick={() => void copy(draft)}>Copy</Button>
          </div>
        </div>
      ) : (
        <p className="text-[var(--muted)]">
          The draft uses only what is in your CV and the advert. Check it before you send it.
        </p>
      )}

      <div>
        <h4 className="mb-1 font-semibold">Earlier drafts</h4>
        {notes.isPending ? <p aria-busy="true">Loading…</p> : null}
        {notes.data && history.length === 0 ? (
          <p className="text-[var(--muted)]">None yet.</p>
        ) : null}
        <ul className="grid gap-2">
          {history.map((n: CoverNote) => (
            <li key={n.id} className="rounded-md border border-[var(--border)] p-2">
              <p className="text-xs text-[var(--muted)]">
                {n.kind === 'cover_note' ? 'Cover note' : 'Recruiter message'} · {n.tone} ·{' '}
                {formatStarted(n.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{n.text}</p>
              <div className="mt-1 flex gap-2">
                <Button variant="ghost" onClick={() => setDraft(n.text)}>
                  Edit this one
                </Button>
                <Button variant="ghost" onClick={() => void copy(n.text)}>
                  Copy
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
