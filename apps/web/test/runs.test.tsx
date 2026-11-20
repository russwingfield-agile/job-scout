import type { RunDetail, RunSummary } from '@job-scout/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { RunsPage } from '../src/features/runs/RunsPage.js';
import { formatDuration, formatStarted, runDuration } from '../src/lib/format.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run1',
  trigger: 'cron',
  status: 'completed',
  phase: 'done',
  startedAt: '2026-11-20T07:00:00.000Z',
  finishedAt: '2026-11-20T07:03:05.000Z',
  counts: { fetched: 120, new: 45, filtered: 30, prefiltered: 15 },
  reedCalls: 52,
  errorCount: 0,
  ...over,
});

type Handler = () => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`;
      calls.push(key);
      const handler = routes[key];
      return handler
        ? handler()
        : json({ error: { code: 'NOT_FOUND', message: `unmocked ${key}`, requestId: 'r' } }, 404);
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RunsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('format helpers', () => {
  it.each([
    [400, '1s'],
    [45_000, '45s'],
    [185_000, '3m 05s'],
    [3_720_000, '1h 02m'],
    [0, '1s'],
  ])('formatDuration(%i ms) → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('shows a running run as "running…" and a finished one as its length', () => {
    expect(runDuration('2026-11-20T07:00:00Z', null)).toBe('running…');
    expect(runDuration('2026-11-20T07:00:00Z', '2026-11-20T07:03:05Z')).toBe('3m 05s');
  });

  it('formats start times in UK time across the clock change', () => {
    expect(formatStarted('2026-11-20T07:00:00Z')).toBe('20 Nov 2026, 07:00'); // GMT
    expect(formatStarted('2026-06-15T06:00:00Z')).toBe('15 Jun 2026, 07:00'); // BST
  });
});

describe('RunsPage', () => {
  it('shows a loading state, then the run history with counts', async () => {
    mockApi({
      'GET /api/runs': () =>
        json([run(), run({ id: 'run2', trigger: 'manual', counts: {}, reedCalls: 0 })]),
    });
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading runs' })).toBeInTheDocument();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 runs
    const first = within(rows[1] as HTMLElement);
    expect(first.getByText('Scheduled')).toBeInTheDocument();
    expect(first.getByText('Completed')).toBeInTheDocument();
    expect(first.getByText('120')).toBeInTheDocument();
    expect(first.getByText('52')).toBeInTheDocument();
    expect(first.getByText('3m 05s')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Manual')).toBeInTheDocument();
  });

  it('invites the first run when there is no history', async () => {
    mockApi({ 'GET /api/runs': () => json([]) });
    renderPage();
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled();
  });

  it('offers a retry when the history cannot be loaded', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/runs': () =>
        ++attempts === 1
          ? json({ error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }, 500)
          : json([]),
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the run history');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
  });

  it('starts a run with "Run now" and says how many searches were queued', async () => {
    const calls = mockApi({
      'GET /api/runs': () => json([]),
      'POST /api/runs': () => json({ runId: 'r9', queries: 3 }, 202),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/Run started: 3 searches queued/)).toBeInTheDocument();
    expect(calls).toContain('POST /api/runs');
  });

  it('explains when there is nothing to search', async () => {
    mockApi({
      'GET /api/runs': () => json([]),
      'POST /api/runs': () => json({ runId: 'r9', queries: 0 }, 202),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/no active search profile/)).toBeInTheDocument();
  });

  it('shows the server message when a run cannot start', async () => {
    mockApi({
      'GET /api/runs': () => json([]),
      'POST /api/runs': () =>
        json(
          {
            error: {
              code: 'NOT_CONFIGURED',
              message: 'Job queues is not configured for this deployment',
              requestId: 'r',
            },
          },
          503,
        ),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/Job queues is not configured/)).toBeInTheDocument();
  });

  it('disables Run now while a run is in progress', async () => {
    mockApi({
      'GET /api/runs': () => json([run({ status: 'running', phase: 'ingest', finishedAt: null })]),
    });
    renderPage();
    const button = await screen.findByRole('button', { name: 'Run in progress' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Running — fetching/)).toBeInTheDocument();
    expect(screen.getByText('running…')).toBeInTheDocument();
  });

  it('opens a run to show its counters and errors, and closes with Escape', async () => {
    const failed = run({ errorCount: 1, status: 'failed' });
    const detail: RunDetail = {
      ...failed,
      pendingIngest: 0,
      pendingScore: 0,
      errors: [
        {
          id: 1,
          stage: 'fetch',
          ref: 'agile coach#0',
          message: 'Reed rejected the API key (HTTP 401)',
          createdAt: '2026-11-20T07:00:05Z',
        },
      ],
    };
    mockApi({
      'GET /api/runs': () => json([failed]),
      'GET /api/runs/run1': () => json(detail),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /Open details of the run started/ }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Run details' });
    expect(await within(drawer).findByText(/Reed rejected the API key/)).toBeInTheDocument();
    expect(within(drawer).getByText('Errors (1)')).toBeInTheDocument();
    expect(within(drawer).getByText('Failed')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows "No errors." for a clean run, and closes with the button', async () => {
    const detail: RunDetail = { ...run(), pendingIngest: 0, pendingScore: 0, errors: [] };
    mockApi({ 'GET /api/runs': () => json([run()]), 'GET /api/runs/run1': () => json(detail) });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open details/ }));
    expect(await screen.findByText('No errors.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close run details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
