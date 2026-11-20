import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning';

const TONES: Record<Tone, string> = {
  neutral: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]',
  success: 'border-[var(--success)] text-[var(--success)]',
  warning: 'border-[var(--warning)] text-[var(--warning)]',
};

/** A small label. Meaning is carried by the text, never by colour alone. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${TONES[tone]}`}>
      {children}
    </span>
  );
}
