import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { AppRoutes } from '../src/router.js';
import { DEFAULT_SETTINGS_FOR_TEST } from './settingsFixture.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; method: string; body: unknown };

function mockApi(extra: (c: Call) => Response | null = () => null) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const custom = extra(call);
      if (custom) return custom;
      if (url.startsWith('/api/stats')) {
        return json({
          newToday: 0,
          inbox: 0,
          shortlisted: 0,
          appliedThisWeek: 0,
          nextScanAt: null,
          aiBudgetPercent: 0,
        });
      }
      if (url === '/api/settings') return json(DEFAULT_SETTINGS_FOR_TEST);
      return json({ error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }, 404);
    }),
  );
  return calls;
}

function renderSettings() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings page', () => {
  it('shows the current limits and scan times', async () => {
    mockApi();
    renderSettings();
    const section = await screen.findByRole('region', { name: 'Scans and limits' });
    expect(within(section).getByLabelText(/Jobs the AI assesses per scan/)).toHaveValue(30);
    expect(within(section).getByLabelText(/Minimum first-pass score/)).toHaveValue(55);
    expect(within(section).getByText('07:00')).toBeInTheDocument();
    expect(within(section).getByText(/Europe\/London time/)).toBeInTheDocument();
  });

  it('saves changed limits as one update', async () => {
    const calls = mockApi((c) => (c.method === 'PUT' ? json(DEFAULT_SETTINGS_FOR_TEST) : null));
    const user = userEvent.setup();
    renderSettings();
    const section = await screen.findByRole('region', { name: 'Scans and limits' });
    const field = within(section).getByLabelText(/Jobs the AI assesses per scan/);
    await user.clear(field);
    await user.type(field, '12');
    await user.click(within(section).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.body).toMatchObject({
        budgets: { maxLlmPerRun: 12 },
        thresholds: { prefilterMin: 55 },
        ingest: { maxAgeDays: 7 },
      });
    });
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });

  it('shows the server’s reason when settings are refused', async () => {
    mockApi((c) =>
      c.method === 'PUT'
        ? json(
            {
              error: {
                code: 'VALIDATION',
                message: 'Invalid settings',
                requestId: 'r',
                issues: [{ path: 'schedule.sat.0', message: 'Expected HH:MM (24h)' }],
              },
            },
            400,
          )
        : null,
    );
    const user = userEvent.setup();
    renderSettings();
    const section = await screen.findByRole('region', { name: 'Scans and limits' });
    await user.click(within(section).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Expected HH:MM/)).toBeInTheDocument();
  });

  it('saves the blocklist', async () => {
    const calls = mockApi((c) => (c.method === 'PUT' ? json(DEFAULT_SETTINGS_FOR_TEST) : null));
    const user = userEvent.setup();
    renderSettings();
    const section = await screen.findByRole('region', { name: 'Blocklist' });
    await user.type(within(section).getByLabelText('Agencies to avoid'), 'Spam Ltd{Enter}');
    await user.click(within(section).getByRole('button', { name: 'Save blocklist' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        blocklist: { employers: [], agencies: ['Spam Ltd'], keywords: [] },
      }),
    );
  });

  it('only enables Delete all data once the exact phrase is typed, then deletes', async () => {
    const calls = mockApi((c) => (c.method === 'DELETE' ? json({ cvs: 2, jobs: 40 }) : null));
    const user = userEvent.setup();
    renderSettings();
    const zone = await screen.findByRole('region', { name: 'Danger zone' });
    const button = within(zone).getByRole('button', { name: 'Delete all data' });
    expect(button).toBeDisabled();

    await user.type(within(zone).getByRole('textbox'), 'delete everything');
    expect(button).toBeDisabled();
    await user.clear(within(zone).getByRole('textbox'));
    await user.type(within(zone).getByRole('textbox'), 'DELETE EVERYTHING');
    expect(button).toBeEnabled();
    await user.click(button);

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({
        confirm: 'DELETE EVERYTHING',
      }),
    );
    expect(await screen.findByText('Deleted 40 jobs and 2 CVs.')).toBeInTheDocument();
    expect(within(zone).getByRole('textbox')).toHaveValue('');
  });

  it('offers a retry when settings cannot be loaded', async () => {
    mockApi((c) =>
      c.url === '/api/settings'
        ? json({ error: { code: 'INTERNAL', message: 'boom', requestId: 'r' } }, 500)
        : null,
    );
    renderSettings();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your settings');
  });
});
