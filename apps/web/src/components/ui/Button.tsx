import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-[var(--accent-text)] border-transparent hover:opacity-90',
  secondary:
    'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-2)]',
  danger:
    'bg-[var(--surface)] text-[var(--danger)] border-[var(--danger)] hover:bg-[var(--surface-2)]',
  ghost: 'bg-transparent text-[var(--muted)] border-transparent hover:bg-[var(--surface-2)]',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Shows a busy state and blocks clicks. */
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading ? <span aria-hidden="true">…</span> : null}
      {children}
    </button>
  );
}
