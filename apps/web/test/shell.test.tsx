import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { AppRoutes } from '../src/router.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app shell', () => {
  it('renders sidebar navigation and redirects / to the Shortlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ToastProvider>
          <MemoryRouter initialEntries={['/']}>
            <AppRoutes />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Shortlist', 'Pipeline', 'CVs', 'Settings', 'Runs']) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByRole('heading', { name: 'Shortlist' })).toBeInTheDocument();
    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });

  it('shows a placeholder for pages that are not built yet', () => {
    render(
      <MemoryRouter initialEntries={['/pipeline']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByText(/Coming in a later milestone/)).toBeInTheDocument();
  });
});
