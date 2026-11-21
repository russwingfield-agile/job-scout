import { ApiError } from '../../api/client.js';
import { useSuggestionAction, useSuggestions } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';

/** Advice drawn from what you keep skipping ("raise your minimum rate?"). Apply or dismiss each. */
export function SuggestionCards() {
  const suggestions = useSuggestions();
  const apply = useSuggestionAction('apply');
  const dismiss = useSuggestionAction('dismiss');
  const toast = useToast();

  const items = suggestions.data ?? [];
  if (items.length === 0) return null;

  const fail = (err: unknown) =>
    toast.push('error', err instanceof ApiError ? err.message : 'That did not work. Try again.');

  return (
    <section aria-label="Suggestions" className="grid gap-2">
      {items.map((s) => (
        <div
          key={s.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-3 text-sm"
        >
          <p className="min-w-0 flex-1">
            <strong>Suggestion: </strong>
            {s.message}
          </p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={apply.isPending && apply.variables === s.id}
              onClick={() =>
                apply
                  .mutateAsync(s.id)
                  .then(() =>
                    toast.push('success', 'Search profile updated. It applies from the next scan.'),
                  )
                  .catch(fail)
              }
            >
              {s.actionLabel}
            </Button>
            <Button variant="ghost" onClick={() => dismiss.mutate(s.id, { onError: fail })}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
