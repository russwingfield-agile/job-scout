import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'warning';
export type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; kind: ToastKind; message: string; action?: ToastAction | undefined };

const AUTO_DISMISS_MS = 6_000;
const KIND_STYLE: Record<ToastKind, string> = {
  success: 'border-[var(--success)]',
  error: 'border-[var(--danger)]',
  warning: 'border-[var(--warning)]',
};
const KIND_LABEL: Record<ToastKind, string> = {
  success: 'Done',
  error: 'Error',
  warning: 'Heads up',
};

type ToastApi = { push: (kind: ToastKind, message: string, action?: ToastAction) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Announces messages politely to screen readers; each also has a visible label, not just colour. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback(
    (kind: ToastKind, message: string, action?: ToastAction) => {
      const id = Date.now() + Math.random();
      setItems((all) => [...all, { id, kind, message, action }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border bg-[var(--surface)] p-3 text-sm shadow-lg ${KIND_STYLE[t.kind]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p>
                <strong>{KIND_LABEL[t.kind]}: </strong>
                {t.message}
              </p>
              {t.action ? (
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="text-[var(--muted)]"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
