import type { CoverNote, GroupDetail, GroupListItem, Suggestion } from '@job-scout/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast.js';
import { AppRoutes } from '../src/router.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const listItem: GroupListItem = {
  id: 'g1',
  status: 'new',
  prefilterScore: 70,
  finalScore: 80,
  assessment: null,
  filterReason: null,
  bestCv: 'Agile Coach',
  bestCvId: 'cv1',
  alsoPostedBy: [],
  newPostingsSinceAction: 0,
  feedbackAdj: -5,
  feedbackReasons: ['−5: similar to jobs you skipped as not your skills'],
  application: null,
  job: {
    title: 'Agile Coach',
    employerName: 'Acme',
    location: 'London',
    employmentType: 'contract',
    workMode: null,
    payText: '£600/day',
    ir35: null,
    contractLengthMonths: null,
    postedAt: null,
    url: null,
  },
};
const detail: GroupDetail = {
  item: listItem,
  postings: [],
  descriptionText: 'Advert',
  assessment: null,
  cvScores: [],
  history: [],
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
];
const STATS = {
  newToday: 0,
  inbox: 1,
  shortlisted: 0,
  appliedThisWeek: 0,
  nextScanAt: null,
  aiBudgetPercent: 0,
};
const note = (id: string, text: string): CoverNote => ({
  id,
  groupId: 'g1',
  cvId: 'cv1',
  kind: 'cover_note',
  tone: 'concise',
  text,
  createdAt: '2026-11-19T10:00:00.000Z',
});

type Call = { url: string; method: string; body: unknown };

function mockApi(
  opts: {
    notes?: CoverNote[];
    suggestions?: Suggestion[];
    extra?: (c: Call) => Response | null;
  } = {},
) {
  const calls: Call[] = [];
  let notes = opts.notes ?? [];
  let suggestions = opts.suggestions ?? [];
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
      const custom = opts.extra?.(call);
      if (custom) return custom;
      if (url === '/api/groups/g1/cover-note' && call.method === 'POST') {
        const created = note('n2', 'A fresh draft. Jane');
        notes = [created, ...notes];
        return json(created, 201);
      }
      if (url === '/api/groups/g1/cover-notes') return json(notes);
      if (url === '/api/groups/g1') return json(detail);
      if (url.startsWith('/api/suggestions/')) {
        suggestions = [];
        return json({ ok: true });
      }
      if (url === '/api/suggestions') return json(suggestions);
      if (url.startsWith('/api/stats')) return json(STATS);
      if (url.startsWith('/api/cvs')) return json(CVS);
      if (url.startsWith('/api/settings')) {
        return json({
          thresholds: { prefilterMin: 55, badgeStrong: 80, badgeGood: 65, badgeMaybe: 50 },
        });
      }
      if (url.startsWith('/api/groups?')) return json({ items: [listItem], total: 1 });
      return json({ error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }, 404);
    }),
  );
  return calls;
}

function renderApp(path: string) {
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

describe('cover note panel', () => {
  it('c opens the job on its Cover note tab', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('/inbox');
    await screen.findByRole('article', { name: 'Agile Coach' });
    await user.keyboard('c');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    expect(
      await within(drawer).findByRole('button', { name: 'Write a draft' }),
    ).toBeInTheDocument();
    expect(within(drawer).getByRole('tab', { name: 'Cover note' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('writes a draft from the chosen CV, kind and tone, lets you edit it, and keeps the history', async () => {
    const calls = mockApi({ notes: [note('n1', 'An older draft. Jane')] });
    const user = userEvent.setup();
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    await user.click(await within(drawer).findByRole('tab', { name: 'Cover note' }));
    expect(await within(drawer).findByText('An older draft. Jane')).toBeInTheDocument();

    await user.selectOptions(within(drawer).getByLabelText('What to write'), 'recruiter_message');
    await user.selectOptions(within(drawer).getByLabelText('Tone'), 'warm');
    await user.click(within(drawer).getByRole('button', { name: 'Write a draft' }));

    const box = await within(drawer).findByLabelText(/Draft \(you can edit it\)/);
    expect(box).toHaveValue('A fresh draft. Jane');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      cvId: 'cv1',
      kind: 'recruiter_message',
      tone: 'warm',
    });
    expect(within(drawer).getByText('4 words')).toBeInTheDocument();

    await user.type(box, ' Thanks!');
    expect(within(drawer).getByText('5 words')).toBeInTheDocument();
    // Both drafts are listed, the new one first.
    expect(await within(drawer).findAllByText(/draft\. Jane/)).toHaveLength(3);
  });

  it('copies the draft', async () => {
    mockApi({ notes: [note('n1', 'An older draft. Jane')] });
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    await user.click(await within(drawer).findByRole('tab', { name: 'Cover note' }));
    await user.click(await within(drawer).findByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('An older draft. Jane');
    expect(await screen.findByText(/Copied to the clipboard/)).toBeInTheDocument();
  });

  it('shows the reason when a draft cannot be written', async () => {
    mockApi({
      extra: (c) =>
        c.method === 'POST'
          ? json(
              {
                error: {
                  code: 'BUDGET_EXHAUSTED',
                  message: "Today's AI allowance is used up.",
                  requestId: 'r',
                },
              },
              429,
            )
          : null,
    });
    const user = userEvent.setup();
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    await user.click(await within(drawer).findByRole('tab', { name: 'Cover note' }));
    await user.click(within(drawer).getByRole('button', { name: 'Write a draft' }));
    expect(await screen.findByText(/AI allowance is used up/)).toBeInTheDocument();
    expect(within(drawer).queryByLabelText(/Draft/)).not.toBeInTheDocument();
  });
});

describe('score adjustments', () => {
  it('explains how your past choices changed the score', async () => {
    mockApi();
    renderApp('/job/g1');
    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    expect(
      await within(drawer).findByText(/How your past choices changed this score \(-?−?5\)/),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(/similar to jobs you skipped as not your skills/),
    ).toBeInTheDocument();
  });
});

describe('suggestions', () => {
  const suggestion: Suggestion = {
    id: 'min_day_rate:p1:600',
    profileId: 'p1',
    kind: 'min_day_rate',
    message: 'You have skipped 5 jobs for a low day rate.',
    actionLabel: 'Raise minimum to £600/day',
  };

  it('applies a suggestion with one click', async () => {
    const calls = mockApi({ suggestions: [suggestion] });
    const user = userEvent.setup();
    renderApp('/inbox');
    const card = await screen.findByRole('region', { name: 'Suggestions' });
    expect(card).toHaveTextContent('skipped 5 jobs');
    await user.click(within(card).getByRole('button', { name: 'Raise minimum to £600/day' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/suggestions/apply')?.body).toEqual({
        id: suggestion.id,
      }),
    );
    expect(await screen.findByText(/Search profile updated/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Suggestions' })).not.toBeInTheDocument(),
    );
  });

  it('can be dismissed', async () => {
    const calls = mockApi({ suggestions: [suggestion] });
    const user = userEvent.setup();
    renderApp('/inbox');
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/suggestions/dismiss')).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Suggestions' })).not.toBeInTheDocument(),
    );
  });

  it('shows nothing when there is no advice', async () => {
    mockApi();
    renderApp('/inbox');
    await screen.findByRole('article', { name: 'Agile Coach' });
    expect(screen.queryByRole('region', { name: 'Suggestions' })).not.toBeInTheDocument();
  });
});
