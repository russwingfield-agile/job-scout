import type { GroupDetail, GroupListItem } from '@job-scout/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { AppRoutes } from '../src/router.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = (
  over: Partial<GroupListItem> = {},
  job: Partial<GroupListItem['job']> = {},
): GroupListItem => ({
  id: 'g1',
  status: 'new',
  prefilterScore: 71.4,
  finalScore: 83.4,
  assessment: {
    status: 'ok',
    fitScore: 88,
    headline: 'Strong SAFe match at a bank',
    strengths: ['Led a SAFe rollout', 'Banking experience', 'Coached 10 teams', 'Fourth one'],
    gaps: ['No public sector', 'Little Kanban', 'third gap'],
    redFlags: ['rate not stated'],
    recommendation: 'apply',
    seniorityMatch: 'match',
    onsiteDaysPerWeek: 2,
  },
  filterReason: null,
  bestCv: 'Agile Coach',
  bestCvId: 'cv1',
  alsoPostedBy: [],
  newPostingsSinceAction: 0,
  feedbackAdj: 0,
  feedbackReasons: [],
  application: null,
  job: {
    source: 'reed',
    title: 'Enterprise Agile Coach',
    employerName: 'Acme Recruitment',
    location: 'London',
    employmentType: 'contract',
    workMode: 'hybrid',
    payText: '£600-£650/day',
    ir35: 'outside',
    contractLengthMonths: 6,
    postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    url: 'https://www.reed.co.uk/jobs/1',
    ...job,
  },
  ...over,
});

const STATS = {
  newToday: 2,
  inbox: 5,
  shortlisted: 1,
  appliedThisWeek: 3,
  nextScanAt: '2099-01-01T12:00:00.000Z',
  aiBudgetPercent: 42,
};
const CVS = [
  {
    id: 'cv1',
    label: 'Agile Coach',
    filename: null,
    summary: null,
    active: true,
    profileId: 'p1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'cv2',
    label: 'Scrum Master',
    filename: null,
    summary: null,
    active: true,
    profileId: 'p2',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
];

type Call = { url: string; method: string; body: unknown };

/** Route fetches by method and path; anything unlisted is a 404 so surprises fail loudly. */
function mockApi(
  lists: Record<string, GroupListItem[]> | ((url: string) => GroupListItem[]),
  extra: (c: Call) => Response | null = () => null,
) {
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
      if (url.startsWith('/api/stats')) return json(STATS);
      if (url.startsWith('/api/cvs')) return json(CVS);
      if (url.startsWith('/api/settings')) {
        return json({
          thresholds: { prefilterMin: 55, badgeStrong: 80, badgeGood: 65, badgeMaybe: 50 },
        });
      }
      if (url.startsWith('/api/groups?')) {
        const items = typeof lists === 'function' ? lists(url) : (lists.default ?? []);
        return json({ items, total: items.length });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    }),
  );
  return calls;
}

function renderApp(path = '/inbox') {
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TWO = [item(), item({ id: 'g2' }, { title: 'Scrum Master', url: null })];

describe('Inbox cards', () => {
  it('shows score and band, headline, up to 3 strengths and 2 gaps, flags and key facts', async () => {
    mockApi({
      default: [
        item({ alsoPostedBy: [{ id: 'x', employerName: 'Other Agency', payText: '£700/day' }] }),
      ],
    });
    renderApp();
    const card = await screen.findByRole('article', { name: 'Enterprise Agile Coach' });
    const c = within(card);

    expect(c.getByText('83')).toBeInTheDocument();
    expect(c.getByText('Strong')).toBeInTheDocument();
    expect(c.getByText('Strong SAFe match at a bank')).toBeInTheDocument();
    expect(c.getByText('Led a SAFe rollout')).toBeInTheDocument();
    expect(c.queryByText('Fourth one')).not.toBeInTheDocument();
    expect(c.getByText('Little Kanban')).toBeInTheDocument();
    expect(c.queryByText('third gap')).not.toBeInTheDocument();
    expect(c.getByText(/rate not stated/)).toBeInTheDocument();
    expect(c.getByText('£600-£650/day')).toBeInTheDocument();
    expect(c.getByText('Outside IR35')).toBeInTheDocument();
    expect(c.getByText(/Hybrid · 2 days on site/)).toBeInTheDocument();
    expect(c.getByText(/6 months/)).toBeInTheDocument();
    expect(c.getByText('3 days ago')).toBeInTheDocument();
    expect(c.getByText(/Also posted by/)).toHaveTextContent('Other Agency (£700/day)');
    const advert = c.getByRole('link', { name: /Open advert/ });
    expect(advert).toHaveAttribute('target', '_blank');
    expect(advert).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('copes with a job the AI has not rated and with almost no data', async () => {
    mockApi({
      default: [
        item(
          { finalScore: null, assessment: null, bestCv: null, prefilterScore: 71.4 },
          {
            title: null,
            employerName: null,
            location: null,
            employmentType: null,
            workMode: null,
            ir35: null,
            postedAt: null,
            url: null,
            contractLengthMonths: null,
          },
        ),
      ],
    });
    renderApp();
    const card = await screen.findByRole('article', { name: 'Untitled role' });
    expect(within(card).getByText('~71')).toBeInTheDocument();
    expect(within(card).getByText('Unrated')).toBeInTheDocument();
    expect(within(card).getByText(/Unknown employer/)).toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says when the AI could not assess a job', async () => {
    mockApi({
      default: [
        item({
          finalScore: null,
          assessment: {
            status: 'failed',
            fitScore: null,
            headline: null,
            strengths: [],
            gaps: [],
            redFlags: [],
            recommendation: null,
            seniorityMatch: null,
            onsiteDaysPerWeek: null,
          },
        }),
      ],
    });
    renderApp();
    expect(await screen.findByText(/could not assess this job/)).toBeInTheDocument();
  });

  it('shows the header stats and, when empty, when the next scan is', async () => {
    mockApi({ default: [] });
    renderApp();
    const stats = await screen.findByRole('list', { name: 'Today' });
    expect(stats).toHaveTextContent('2 new today');
    expect(stats).toHaveTextContent('3 applied this week');
    expect(stats).toHaveTextContent('AI today 42%');
    expect(await screen.findByText(/You're all caught up\. Next scan/)).toBeInTheDocument();
  });

  it('shows a loading state, then an error with a retry', async () => {
    let fail = true;
    mockApi(
      () => [],
      (c) =>
        c.url.startsWith('/api/groups?') && fail
          ? json({ error: { code: 'INTERNAL', message: 'boom' } }, 500)
          : null,
    );
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByRole('status', { name: 'Loading jobs' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your jobs');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/all caught up/)).toBeInTheDocument();
  });
});

describe('Inbox filters', () => {
  it('asks the server for what you pick, and keeps it in the address', async () => {
    const calls = mockApi({ default: TWO });
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByRole('article');

    await user.click(screen.getByRole('button', { name: 'Perm' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'IR35' }), 'outside');
    await user.selectOptions(screen.getByLabelText('Min score'), '65');
    await waitFor(() => {
      const last = calls.filter((c) => c.url.startsWith('/api/groups?')).at(-1)?.url ?? '';
      expect(last).toContain('type=permanent');
      expect(last).toContain('ir35=outside');
      expect(last).toContain('minScore=65');
    });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      const last = calls.filter((c) => c.url.startsWith('/api/groups?')).at(-1)?.url ?? '';
      expect(last).not.toContain('type=');
    });
  });

  it('switches to lower matches and filtered-out jobs, which have no triage buttons', async () => {
    const calls = mockApi((url) =>
      url.includes('show=filtered')
        ? [
            item({
              id: 'f1',
              status: 'filtered',
              filterReason: 'below_min_day_rate',
              finalScore: null,
              assessment: null,
            }),
          ]
        : TWO,
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('tab', { name: 'Filtered out' }));
    expect(await screen.findByText(/Below your minimum day rate/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Shortlist' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Lower matches' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('show=more'))).toBe(true));
  });
});

describe('triage with the keyboard', () => {
  it('j and k move the focus ring', async () => {
    mockApi({ default: TWO });
    const user = userEvent.setup();
    renderApp();
    const first = await screen.findByRole('article', { name: 'Enterprise Agile Coach' });
    const second = screen.getByRole('article', { name: 'Scrum Master' });
    expect(first).toHaveAttribute('aria-current', 'true');
    await user.keyboard('j');
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(first).not.toHaveAttribute('aria-current');
    await user.keyboard('k');
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('a shortlists the focused job at once, and Undo puts it back', async () => {
    let shortlisted = false;
    const calls = mockApi(
      () => (shortlisted ? [TWO[1] as GroupListItem] : TWO),
      (c) => {
        if (c.method === 'PATCH') {
          shortlisted = (c.body as { status: string }).status === 'shortlisted';
          return json({ status: (c.body as { status: string }).status });
        }
        return null;
      },
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Enterprise Agile Coach' });

    await user.keyboard('a');
    await waitFor(() =>
      expect(
        screen.queryByRole('article', { name: 'Enterprise Agile Coach' }),
      ).not.toBeInTheDocument(),
    );
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/api/groups/g1', body: { status: 'shortlisted' } });
    expect(await screen.findByText(/Shortlisted “Enterprise Agile Coach”/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ status: 'new' }),
    );
    expect(
      await screen.findByRole('article', { name: 'Enterprise Agile Coach' }),
    ).toBeInTheDocument();
  });

  it('x asks why, a number key picks the reason, Escape cancels', async () => {
    const calls = mockApi({ default: TWO }, (c) =>
      c.method === 'PATCH' ? json({ status: 'skipped' }) : null,
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByRole('article');

    await user.keyboard('x');
    expect(screen.getByRole('dialog', { name: /Why skip/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    await user.keyboard('x');
    await user.keyboard('2');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        status: 'skipped',
        skipReason: 'location',
      }),
    );
  });

  it('puts the job back and says so when the server refuses', async () => {
    mockApi({ default: TWO }, (c) =>
      c.method === 'PATCH'
        ? json(
            { error: { code: 'CONFLICT', message: 'Not allowed right now', requestId: 'r1' } },
            409,
          )
        : null,
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('article', { name: 'Enterprise Agile Coach' });
    await user.keyboard('a');
    expect(await screen.findByText(/Not allowed right now/)).toBeInTheDocument();
    expect(
      await screen.findByRole('article', { name: 'Enterprise Agile Coach' }),
    ).toBeInTheDocument();
  });

  it('ignores shortcut keys while you are typing in a field, and ? shows the help', async () => {
    const calls = mockApi({ default: TWO });
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByRole('article');
    const select = screen.getByRole('combobox', { name: 'Work mode' });
    select.focus();
    await user.keyboard('a');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    (document.activeElement as HTMLElement).blur();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
  });
});

describe('clear all found jobs', () => {
  it('only after you confirm, then reloads the list', async () => {
    const calls = mockApi({ default: [] }, (c) =>
      c.url === '/api/groups/clear' ? json({ removed: 7 }) : null,
    );
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const user = userEvent.setup();
    renderApp();
    const button = await screen.findByRole('button', { name: 'Clear all found jobs' });
    await user.click(button);
    expect(calls.some((c) => c.url === '/api/groups/clear')).toBe(false);
    await user.click(button);
    expect(await screen.findByText(/Cleared 7 jobs/)).toBeInTheDocument();
  });
});

describe('Pipeline', () => {
  const applied = item({
    id: 'p1',
    status: 'applied',
    application: {
      cvIdSent: 'cv1',
      appliedAt: '2026-11-18T12:00:00.000Z',
      notes: null,
      skipReason: null,
    },
    newPostingsSinceAction: 2,
  });
  const shortlisted = item({ id: 'p2', status: 'shortlisted' }, { title: 'Scrum Master' });

  it('lays jobs out by stage and flags new postings since you applied', async () => {
    mockApi({ default: [applied, shortlisted] });
    renderApp('/pipeline');
    const applied_ = await screen.findByRole('region', { name: 'Applied' });
    expect(within(applied_).getByText('Enterprise Agile Coach')).toBeInTheDocument();
    expect(within(applied_).getByText(/\+2 new postings since you acted/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Shortlisted' })).getByText('Scrum Master'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Skipped' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByLabelText('Show skipped and withdrawn'));
    expect(screen.getByRole('region', { name: 'Skipped' })).toBeInTheDocument();
  });

  it('moves a card through its menu', async () => {
    const calls = mockApi({ default: [applied] }, (c) =>
      c.method === 'PATCH' ? json({ status: 'interview' }) : null,
    );
    const user = userEvent.setup();
    renderApp('/pipeline');
    await screen.findByText('Enterprise Agile Coach');
    await user.selectOptions(screen.getByLabelText(/Move Enterprise Agile Coach to/), 'interview');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'interview' }),
    );
  });

  it('asks which CV you sent before recording an application', async () => {
    const calls = mockApi({ default: [shortlisted] }, (c) =>
      c.method === 'PATCH' ? json({ status: 'applied' }) : null,
    );
    const user = userEvent.setup();
    renderApp('/pipeline');
    await screen.findByText('Scrum Master');
    await user.selectOptions(screen.getByLabelText(/Move Scrum Master to/), 'applied');
    const dialog = screen.getByRole('dialog', { name: /Applied to/ });
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    await user.selectOptions(within(dialog).getByLabelText(/Which CV/), 'cv2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const body = calls.find((c) => c.method === 'PATCH')?.body as Record<string, string>;
      expect(body).toMatchObject({ status: 'applied', cvIdSent: 'cv2' });
      expect(body.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it('explains an empty pipeline', async () => {
    mockApi({ default: [] });
    renderApp('/pipeline');
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
  });
});

describe('job drawer', () => {
  const detail: GroupDetail = {
    item: item(),
    postings: [
      {
        id: 'j1',
        employerName: 'Acme Recruitment',
        isAgency: true,
        location: 'London',
        payText: '£600-£650/day',
        postedAt: null,
        url: 'https://www.reed.co.uk/jobs/1',
        externalApplyUrl: null,
      },
      {
        id: 'j2',
        employerName: 'Other Agency',
        isAgency: true,
        location: 'London',
        payText: '£700/day',
        postedAt: null,
        url: null,
        externalApplyUrl: 'https://example.com/apply',
      },
    ],
    descriptionText: 'Lead an agile transformation.\n\nSAFe essential.',
    assessment: null,
    cvScores: [
      { cvId: 'cv1', label: 'Agile Coach', similarity: 0.82, score: 88 },
      { cvId: 'cv2', label: 'Scrum Master', similarity: 0.6, score: null },
    ],
    history: [{ id: 1, from: 'new', to: 'shortlisted', at: '2026-11-19T10:00:00.000Z' }],
  };

  const open = (extra: (c: Call) => Response | null = () => null) =>
    mockApi({ default: [item()] }, (c) =>
      c.url === '/api/groups/g1' && c.method === 'GET' ? json(detail) : extra(c),
    );

  it('is reachable by its own address and shows score bars per CV', async () => {
    open();
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    expect(await within(drawer).findByText('How each CV matches')).toBeInTheDocument();
    expect(within(drawer).getByText('88')).toBeInTheDocument();
    expect(within(drawer).getByText(/60% text match/)).toBeInTheDocument();
  });

  it('shows every posting, the advert text, and history', async () => {
    open();
    const user = userEvent.setup();
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    await within(drawer).findByText('How each CV matches');

    await user.click(within(drawer).getByRole('tab', { name: 'Postings' }));
    expect(within(drawer).getByText('Other Agency')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /Apply on the employer/ })).toHaveAttribute(
      'href',
      'https://example.com/apply',
    );

    await user.click(within(drawer).getByRole('tab', { name: 'Advert' }));
    expect(within(drawer).getByText(/Lead an agile transformation/)).toBeInTheDocument();

    await user.click(within(drawer).getByRole('tab', { name: 'Notes & history' }));
    expect(within(drawer).getByText('Shortlisted')).toBeInTheDocument();
  });

  it('saves notes', async () => {
    const calls = open((c) => (c.url === '/api/groups/g1/notes' ? json({ ok: true }) : null));
    const user = userEvent.setup();
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    await within(drawer).findByText('How each CV matches');
    await user.click(within(drawer).getByRole('tab', { name: 'Notes & history' }));
    await user.type(within(drawer).getByLabelText('Notes'), 'Call Sam');
    await user.click(within(drawer).getByRole('button', { name: 'Save notes' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/notes'))?.body).toEqual({ notes: 'Call Sam' }),
    );
  });

  it('closes with the button, returning to the Inbox', async () => {
    open();
    const user = userEvent.setup();
    renderApp('/job/g1');
    await user.click(await screen.findByRole('button', { name: 'Close job details' }));
    expect(screen.queryByRole('dialog', { name: 'Job details' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('says so when the job no longer exists', async () => {
    mockApi({ default: [] }, (c) =>
      c.url === '/api/groups/gone'
        ? json({ error: { code: 'NOT_FOUND', message: 'Job not found', requestId: 'r1' } }, 404)
        : null,
    );
    renderApp('/job/gone');
    expect(await screen.findByText('This job no longer exists.')).toBeInTheDocument();
  });
});
