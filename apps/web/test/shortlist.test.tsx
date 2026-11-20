import type { GroupListItem } from '@job-scout/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortlistPage } from '../src/features/inbox/ShortlistPage.js';
import { describeFilterReason, postedAgo } from '../src/lib/jobFormat.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = (
  over: Partial<GroupListItem> = {},
  job: Partial<GroupListItem['job']> = {},
): GroupListItem => ({
  id: 'g1',
  status: 'prefiltered',
  prefilterScore: 71.4,
  finalScore: null,
  assessment: null,
  filterReason: null,
  bestCv: 'Agile Coach',
  job: {
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

function mockApi(handler: (url: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return handler(String(input));
    }),
  );
  return calls;
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ShortlistPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postedAgo', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  it.each([
    [null, '—'],
    ['2026-11-20T01:00:00Z', 'today'],
    ['2026-11-21T01:00:00Z', 'today'], // clock skew: never "-1 days ago"
    ['2026-11-19T11:00:00Z', 'yesterday'],
    ['2026-11-17T12:00:00Z', '3 days ago'],
  ])('%s → %s', (iso, expected) => {
    expect(postedAgo(iso, now)).toBe(expected);
  });
});

describe('describeFilterReason', () => {
  it.each([
    [null, '—'],
    ['', '—'],
    ['below_min_day_rate', 'Below your minimum day rate'],
    ['below_min_salary', 'Below your minimum salary'],
    ['inside_ir35', 'Inside IR35'],
    ['too_old', 'Posted too long ago'],
    ['no_longer_available', 'No longer on Reed'],
    ['no_matching_profile', 'No matching search profile'],
    ['excluded_keyword:graduate', 'Contains "graduate"'],
    ['employment_type:temp', 'Not a type you want (temp)'],
    ['work_mode:onsite', 'Work mode: onsite'],
    ['blocked_employer:Spam Ltd', 'Blocked employer: Spam Ltd'],
    ['blocked_keyword:unpaid', 'Blocked word: unpaid'],
    [
      'below_min_day_rate; excluded_keyword:junior',
      'Below your minimum day rate; Contains "junior"',
    ],
    ['something_new', 'something_new'],
    ['mystery:detail', 'mystery:detail'],
    ['blocked_employer:a:b', 'Blocked employer: a:b'],
  ])('%s → %s', (reason, expected) => {
    expect(describeFilterReason(reason)).toBe(expected);
  });
});

describe('ShortlistPage', () => {
  it('shows jobs with score, role link, pay, IR35 and best CV, and says how many there are', async () => {
    mockApi(() =>
      json({
        items: [
          item(),
          item(
            { id: 'g2', prefilterScore: 40 },
            {
              title: 'Scrum Master',
              ir35: 'unknown',
              workMode: 'unknown',
              payText: 'Not stated',
              contractLengthMonths: null,
              url: null,
            },
          ),
        ],
        total: 57,
      }),
    );
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading jobs' })).toBeInTheDocument();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);

    const first = within(rows[1] as HTMLElement);
    expect(first.getByText('~71')).toBeInTheDocument();
    const link = first.getByRole('link', { name: /Enterprise Agile Coach/ });
    expect(link).toHaveAttribute('href', 'https://www.reed.co.uk/jobs/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(first.getByText('£600-£650/day')).toBeInTheDocument();
    expect(first.getByText('Outside IR35')).toBeInTheDocument();
    expect(first.getByText('Hybrid')).toBeInTheDocument();
    expect(first.getByText('3 days ago')).toBeInTheDocument();
    expect(first.getByText('Agile Coach')).toBeInTheDocument();
    expect(first.getByText(/6 months/)).toBeInTheDocument();

    // A job with no advert link renders as plain text, and unknown values as dashes.
    const second = within(rows[2] as HTMLElement);
    expect(second.queryByRole('link')).not.toBeInTheDocument();
    expect(second.getByText('Scrum Master')).toBeInTheDocument();
    // Both the pay and the IR35 cells say "Not stated" for this job.
    expect(second.getAllByText('Not stated')).toHaveLength(2);

    expect(screen.getByText('Showing 2 of 57')).toBeInTheDocument();
  });

  it('shows the AI score, headline and red flags for an assessed job, and says when the AI failed', async () => {
    mockApi(() =>
      json({
        items: [
          item({
            status: 'new',
            finalScore: 83.4,
            assessment: {
              status: 'ok',
              fitScore: 88,
              headline: 'Strong SAFe match at a bank',
              strengths: [],
              gaps: [],
              redFlags: ['rate not stated', 'clearance required'],
              recommendation: 'apply',
            },
          }),
          item(
            {
              id: 'g2',
              status: 'new',
              assessment: {
                status: 'failed',
                fitScore: null,
                headline: null,
                strengths: [],
                gaps: [],
                redFlags: [],
                recommendation: null,
              },
            },
            { title: 'Scrum Master' },
          ),
        ],
        total: 2,
      }),
    );
    renderPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');

    const assessed = within(rows[1] as HTMLElement);
    expect(assessed.getByText('83')).toBeInTheDocument();
    expect(assessed.getByText('Strong SAFe match at a bank')).toBeInTheDocument();
    expect(assessed.getByText(/rate not stated · clearance required/)).toBeInTheDocument();

    const failed = within(rows[2] as HTMLElement);
    expect(failed.getByText('~71')).toBeInTheDocument();
    expect(failed.getByText(/AI could not assess this job/)).toBeInTheDocument();
  });

  it('tells you what to do when there are no jobs yet', async () => {
    mockApi(() => json({ items: [], total: 0 }));
    renderPage();
    expect(await screen.findByText(/Click Run now|click Run now/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches to the filtered jobs with the reason in plain words', async () => {
    const calls = mockApi((url) =>
      url.includes('show=filtered')
        ? json({
            items: [
              item(
                {
                  id: 'f1',
                  status: 'filtered',
                  prefilterScore: null,
                  filterReason: 'below_min_day_rate; excluded_keyword:graduate',
                },
                { title: 'Graduate Agile Coach' },
              ),
            ],
            total: 1,
          })
        : json({ items: [item()], total: 1 }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Enterprise Agile Coach');

    await user.click(screen.getByLabelText(/Show jobs that were hidden/));
    expect(await screen.findByText('Graduate Agile Coach')).toBeInTheDocument();
    expect(
      screen.getByText('Below your minimum day rate; Contains "graduate"'),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Why hidden' })).toBeInTheDocument();
    expect(calls.some((c) => c.includes('show=filtered'))).toBe(true);
  });

  it('has its own empty message for the filtered view', async () => {
    mockApi((url) =>
      json({
        items: url.includes('show=filtered') ? [] : [item()],
        total: url.includes('show=filtered') ? 0 : 1,
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Enterprise Agile Coach');
    await user.click(screen.getByLabelText(/Show jobs that were hidden/));
    expect(await screen.findByText('No jobs have been filtered out yet.')).toBeInTheDocument();
  });

  it('offers a retry when the jobs cannot be loaded', async () => {
    let attempts = 0;
    mockApi(() =>
      ++attempts === 1
        ? json({ error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }, 500)
        : json({ items: [], total: 0 }),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your jobs');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });

  it('shows a dash for a job with no score', async () => {
    mockApi(() =>
      json({
        items: [
          item(
            { prefilterScore: null },
            {
              title: null,
              employerName: null,
              location: null,
              employmentType: null,
              workMode: null,
              ir35: null,
              postedAt: null,
            },
          ),
        ],
        total: 1,
      }),
    );
    renderPage();
    expect(await screen.findByText('Untitled role')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(3);
  });
});
