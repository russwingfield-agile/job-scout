import { ReedJobDetailsSchema } from '@job-scout/shared';
import { ReedAdapter } from '../../src/adapters/reed/adapter.js';
import type { NormaliseContext } from '../../src/core/normalise.js';
import { AppError } from '../../src/lib/errors.js';
import type { RawJob, RawJobRef, SearchQuery, SourceAdapter } from '../../src/ports/source.js';
import { fakeReedHttp } from './fakeReedHttp.js';

/** A Reed-shaped job advert (the `jobs/{id}` response) with sensible contract defaults. */
export const reedJob = (id: number, over: Record<string, unknown> = {}) => ({
  jobId: id,
  employerName: 'Acme Recruitment',
  jobTitle: 'Agile Coach',
  locationName: 'London',
  salary: '£600 - £650 per day',
  salaryType: 'per day',
  contractType: 'Contract',
  date: '19/11/2026',
  jobDescription:
    '<p>SAFe agile coach for a transformation programme. Outside IR35. 6 month contract.</p>',
  jobUrl: `https://www.reed.co.uk/jobs/${id}`,
  ...over,
});

/** The search hit Reed would return for a job. */
export const refFor = (job: ReturnType<typeof reedJob>): RawJobRef => ({
  sourceJobId: String(job.jobId),
  title: String(job.jobTitle),
  url: String(job.jobUrl),
  employerName: String(job.employerName),
  location: String(job.locationName),
  postedAt: '2026-11-19T00:00:00.000Z',
  applicationsCount: null,
});

/**
 * Scripted job source. `pages` maps a search's keywords to its pages of hits; `details` maps a job
 * id to its advert. Normalisation is the real Reed one. Records every call; errors can be injected.
 */
export class FakeSource implements SourceAdapter {
  readonly id = 'reed';
  readonly searches: { q: SearchQuery; page: number }[] = [];
  readonly detailCalls: string[] = [];
  /** Return an Error to throw for the n-th (1-based) search / details call. */
  searchError: ((n: number) => Error | null) | null = null;
  detailsError: ((n: number) => Error | null) | null = null;

  constructor(
    private readonly data: {
      pages: Record<string, RawJobRef[][]>;
      details: Record<string, ReturnType<typeof reedJob>>;
    },
  ) {}

  async search(q: SearchQuery, page: number) {
    this.searches.push({ q, page });
    const failure = this.searchError?.(this.searches.length);
    if (failure) throw failure;
    const pages = this.data.pages[q.keywords] ?? [];
    return {
      refs: pages[page] ?? [],
      total: pages.flat().length,
      hasMore: page + 1 < pages.length,
    };
  }

  async details(sourceJobId: string): Promise<RawJob> {
    this.detailCalls.push(sourceJobId);
    const failure = this.detailsError?.(this.detailCalls.length);
    if (failure) throw failure;
    const raw = this.data.details[sourceJobId];
    if (!raw) throw new AppError('NOT_FOUND', `job ${sourceJobId} not found`, { retryable: false });
    return { sourceJobId, raw: ReedJobDetailsSchema.parse(raw) };
  }

  normalise(raw: RawJob, ctx: NormaliseContext) {
    return new ReedAdapter(fakeReedHttp({})).normalise(raw, ctx);
  }
}
