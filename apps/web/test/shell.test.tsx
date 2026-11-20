import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { AppRoutes } from '../src/router.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const STATS = {
  newToday: 0,
  inbox: 0,
  shortlisted: 0,
  appliedThisWeek: 0,
  nextScanAt: null,
  aiBudgetPercent: 0,
};

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).startsWith('/api/stats') ? STATS : { items: [], total: 0 };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

function renderAt(path: string) {
  stubApi();
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('app shell', () => {
  it('renders sidebar navigation and redirects / to the Inbox', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Inbox', 'Pipeline', 'CVs', 'Settings', 'Runs']) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(await screen.findByText(/all caught up/)).toBeInTheDocument();
  });

  it('shows the header numbers', async () => {
    renderAt('/inbox');
    expect(await screen.findByRole('list', { name: 'Today' })).toHaveTextContent('0 new today');
  });

  it('shows a placeholder for pages that are not built yet', () => {
    renderAt('/settings');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText(/Coming in a later milestone/)).toBeInTheDocument();
  });
});
