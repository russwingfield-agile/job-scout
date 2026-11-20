import { type KeyboardEvent, useId, useState } from 'react';

export type TagInputProps = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  hint?: string;
  error?: string | undefined;
  placeholder?: string;
};

/** Type a value and press Enter or comma to add it; Backspace on an empty field removes the last. */
export function TagInput({ label, values, onChange, hint, error, placeholder }: TagInputProps) {
  const id = useId();
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const value = raw.trim();
    setDraft('');
    if (value && !values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-md border bg-[var(--surface)] p-1.5 ${
          error ? 'border-[var(--danger)]' : 'border-[var(--border)]'
        }`}
      >
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-sm"
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-[var(--muted)] hover:text-[var(--danger)]"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-[var(--muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
