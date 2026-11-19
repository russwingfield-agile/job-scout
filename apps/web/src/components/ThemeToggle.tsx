import { useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', theme);
  } catch {
    // storage unavailable; theme still applies for this page view
  }
}

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  return (
    <button
      type="button"
      className="rounded-md border px-3 py-1 text-sm"
      style={{ borderColor: 'var(--border)' }}
      onClick={() => {
        const next = NEXT[theme];
        applyTheme(next);
        setTheme(next);
      }}
    >
      Theme: {theme}
    </button>
  );
}
