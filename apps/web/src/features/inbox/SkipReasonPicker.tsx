import type { SkipReason } from '@job-scout/shared';
import { Button } from '../../components/ui/Button.js';
import { SKIP_REASONS } from '../../lib/triage.js';

/** Why are you skipping this job? One click, or the number keys 1–9. Escape cancels. */
export function SkipReasonPicker({
  title,
  onPick,
  onCancel,
}: {
  title: string;
  onPick: (reason: SkipReason) => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={`Why skip ${title}?`}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
    >
      <p className="mb-2 text-sm font-semibold">
        Why skip “{title}”? (press 1–9, or Esc to cancel)
      </p>
      <div className="flex flex-wrap gap-2">
        {SKIP_REASONS.map((r, i) => (
          <Button key={r.value} onClick={() => onPick(r.value)}>
            <kbd className="rounded border border-[var(--border)] px-1 text-xs">{i + 1}</kbd>
            {r.label}
          </Button>
        ))}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
