import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { CvsPage } from '../src/features/cvs/CvsPage.js';

const NOW = '2026-11-20T09:00:00.000Z';
const summary = {
  headline: 'Enterprise Agile Coach leading SAFe transformations',
  seniority: 'senior',
  yearsExperience: 12,
  skills: ['SAFe', 'Kanban'],
  sectors: ['Banking'],
  suggestedTitles: ['Enterprise Agile Coach'],
  suggestedKeywords: ['OKRs'],
};
const profileFor = (cvId: string) => ({
  id: `p-${cvId}`,
  cvId,
  jobTitles: ['Agile Coach'],
  mustKeywords: [],
  excludeKeywords: [],
  locations: ['London'],
  radiusMiles: 25,
  employmentTypes: ['contract', 'permanent'],
  minDayRate: null,
  minSalary: null,
  ir35Preference: 'any',
  workModes: [],
  maxOnsiteDays: null,
  active: true,
  updatedAt: NOW,
});
const detail = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  filename: `${label}.pdf`,
  textMd: `# ${label}\nCV body text`,
  summary,
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  profile: profileFor(id),
  ...extra,
});
const listItem = (d: ReturnType<typeof detail>) => {
  const { textMd: _t, profile, ...rest } = d;
  return { ...rest, profileId: profile.id };
};

type Handler = (body: unknown) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Stub fetch with `METHOD /api/path` handlers; returns the recorded calls. */
function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      return handler
        ? handler(body)
        : json({ error: { code: 'NOT_FOUND', message: `unmocked ${key}`, requestId: 'r' } }, 404);
    }),
  );
  return calls;
}

const settings = (maxActive = 4) =>
  json({
    cvs: {
      maxActive,
      maxUploadBytes: 5 * 1024 * 1024,
      profileDefaults: { radiusMiles: 25, locations: ['London'], employmentTypes: ['contract'] },
    },
    unrelated: true,
  });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CvsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CvsPage', () => {
  it('shows a loading state, then an empty state inviting the first upload', async () => {
    mockApi({ 'GET /api/cvs': () => json([]), 'GET /api/settings': () => settings() });
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading CVs' })).toBeInTheDocument();
    expect(await screen.findByText(/No CVs yet/)).toBeInTheDocument();
    expect(screen.getByText('0 of 4 active CVs.', { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a CV file')).toBeInTheDocument();
  });

  it('lists CVs and opens the first with its summary, text and profile', async () => {
    const a = detail('cv1', 'Agile Coach');
    const b = detail('cv2', 'Delivery Lead', { active: false });
    mockApi({
      'GET /api/cvs': () => json([listItem(a), listItem(b)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'GET /api/cvs/cv2': () => json(b),
    });
    renderPage();

    expect(await screen.findByRole('button', { name: /^Agile Coach/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^Delivery Lead/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('1 of 4 active CVs.', { exact: false })).toBeInTheDocument();

    const panel = await screen.findByRole('region', { name: 'CV: Agile Coach' });
    expect(
      within(panel).getByText('Enterprise Agile Coach leading SAFe transformations'),
    ).toBeInTheDocument();
    expect(within(panel).getByLabelText('Extracted text')).toHaveValue(
      '# Agile Coach\nCV body text',
    );
    expect(within(panel).getByRole('form', { name: 'Search profile' })).toBeInTheDocument();
    expect(within(panel).getByLabelText('Active')).toBeChecked();
  });

  it('switches CVs when one is clicked', async () => {
    const a = detail('cv1', 'Agile Coach');
    const b = detail('cv2', 'Delivery Lead', { active: false });
    mockApi({
      'GET /api/cvs': () => json([listItem(a), listItem(b)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'GET /api/cvs/cv2': () => json(b),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^Delivery Lead/ }));
    const panel = await screen.findByRole('region', { name: 'CV: Delivery Lead' });
    expect(within(panel).getByLabelText('Active')).not.toBeChecked();
  });

  it('says so when every active slot is used instead of offering an upload', async () => {
    const a = detail('cv1', 'Agile Coach');
    mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(1),
      'GET /api/cvs/cv1': () => json(a),
    });
    renderPage();
    expect(await screen.findByText(/All 1 active slots are in use/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a CV file')).not.toBeInTheDocument();
  });

  it('offers a retry when the CV list fails to load', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/cvs': () =>
        ++attempts === 1
          ? json({ error: { code: 'INTERNAL', message: 'boom', requestId: 'r' } }, 500)
          : json([]),
      'GET /api/settings': () => settings(),
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your CVs');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No CVs yet/)).toBeInTheDocument();
  });

  it('re-analyses a CV and surfaces the server warnings', async () => {
    const a = detail('cv1', 'Agile Coach');
    const calls = mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'POST /api/cvs/cv1/analyse': () =>
        json({
          cv: a,
          warnings: ['Could not embed this CV: service down. Click Re-analyse to retry.'],
        }),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Re-analyse' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /api/cvs/cv1/analyse')).toBe(true),
    );

    const needsAttention = await screen.findByRole('status', { name: '' });
    expect(needsAttention).toHaveTextContent('Needs attention');
    expect(needsAttention).toHaveTextContent('Could not embed this CV');
    expect(screen.getAllByText(/Re-analysed|re-analysed/).length).toBeGreaterThan(0);
  });

  it('only enables Save text when the text changed, and saves it', async () => {
    const a = detail('cv1', 'Agile Coach');
    const calls = mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'PATCH /api/cvs/cv1': () => json({ cv: a, warnings: [] }),
    });
    const user = userEvent.setup();
    renderPage();

    const save = await screen.findByRole('button', { name: 'Save text' });
    expect(save).toBeDisabled();
    const editor = screen.getByLabelText('Extracted text');
    await user.type(editor, ' more');
    expect(save).toBeEnabled();
    // Re-analysing stale text would be misleading, so it waits for the save.
    expect(screen.getByRole('button', { name: 'Re-analyse' })).toBeDisabled();

    await user.click(save);
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/cvs/cv1')?.body).toEqual({
        textMd: '# Agile Coach\nCV body text more',
      }),
    );
  });

  it('toggles active through the API', async () => {
    const a = detail('cv1', 'Agile Coach');
    const calls = mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'PATCH /api/cvs/cv1': () => json({ cv: { ...a, active: false }, warnings: [] }),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText('Active'));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/cvs/cv1')?.body).toEqual({ active: false }),
    );
  });

  it('shows the server message when a change is refused', async () => {
    const a = detail('cv1', 'Agile Coach', { active: false });
    mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'PATCH /api/cvs/cv1': () =>
        json(
          {
            error: { code: 'CONFLICT', message: 'You already have 4 active CVs.', requestId: 'r' },
          },
          409,
        ),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText('Active'));
    expect(await screen.findByText(/You already have 4 active CVs/)).toBeInTheDocument();
  });

  it('saves the search profile with validated values', async () => {
    const a = detail('cv1', 'Agile Coach');
    const calls = mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'PUT /api/profiles/p-cv1': (body) => json({ ...profileFor('cv1'), ...(body as object) }),
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Minimum day rate (£)'), '600');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(calls.some((c) => c.key === 'PUT /api/profiles/p-cv1')).toBe(true));
    expect(calls.find((c) => c.key === 'PUT /api/profiles/p-cv1')?.body).toMatchObject({
      minDayRate: 600,
      jobTitles: ['Agile Coach'],
    });
    expect(await screen.findByText(/Profile saved/)).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, then removes the CV', async () => {
    const a = detail('cv1', 'Agile Coach');
    let deleted = false;
    const calls = mockApi({
      'GET /api/cvs': () => json(deleted ? [] : [listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
      'DELETE /api/cvs/cv1': () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete CV' }));
    expect(calls.some((c) => c.key === 'DELETE /api/cvs/cv1')).toBe(false);
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText(/No CVs yet/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'DELETE /api/cvs/cv1')).toBe(true);
  });

  it('can back out of a delete', async () => {
    const a = detail('cv1', 'Agile Coach');
    mockApi({
      'GET /api/cvs': () => json([listItem(a)]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete CV' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete CV' })).toBeInTheDocument();
  });

  it('prompts to re-analyse when a CV has no summary or profile', async () => {
    const a = detail('cv1', 'Agile Coach', { summary: null, profile: null });
    mockApi({
      'GET /api/cvs': () =>
        json([{ ...listItem(detail('cv1', 'Agile Coach', { summary: null })), profileId: null }]),
      'GET /api/settings': () => settings(),
      'GET /api/cvs/cv1': () => json(a),
    });
    renderPage();
    expect(await screen.findByText(/No summary yet/)).toBeInTheDocument();
    expect(screen.getByText(/No profile yet/)).toBeInTheDocument();
    expect(screen.getByText('Not summarised yet')).toBeInTheDocument();
  });
});
