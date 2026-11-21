import { AdzunaResultSchema, type NormalisedJob } from '@job-scout/shared';
import type { NormaliseContext } from '../../src/core/normalise.js';
import { normaliseAdzunaJob } from '../../src/core/normaliseAdzuna.js';
import { AppError } from '../../src/lib/errors.js';
import type {
  RawJob,
  RawJobRef,
  SearchQuery,
  SourceAdapter,
  SourceCallContext,
} from '../../src/ports/source.js';
import type { SourceCallRecorder } from '../../src/ports/sourceCalls.js';

/** An Adzuna search hit with sensible contract defaults. */
export const adzunaHit = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: 'Agile Coach',
  description: 'SAFe agile coach for a transformation programme. Outside IR35. 6 month contract...',
  created: '2026-11-19T10:00:00Z',
  redirect_url: `https://www.adzuna.co.uk/jobs/land/ad/${id}`,
  company: { display_name: 'Acme Recruitment' },
  location: { display_name: 'London' },
  salary_min: 600,
  salary_max: 650,
  salary_is_predicted: '0',
  contract_type: 'contract',
  ...over,
});

/** Scripted Adzuna: inline adverts, no details call, calls recorded like the real client does. */
export class FakeAdzuna implements SourceAdapter {
  readonly id = 'adzuna';
  readonly inlineDetails = true;
  readonly searches: { q: SearchQuery; page: number }[] = [];
  recorder: SourceCallRecorder | null = null;
  searchError: ((n: number) => Error | null) | null = null;

  constructor(private readonly pages: ReturnType<typeof adzunaHit>[][]) {}

  async search(q: SearchQuery, page: number, ctx?: SourceCallContext) {
    this.searches.push({ q, page });
    await this.recorder?.record({
      runId: ctx?.runId,
      source: 'adzuna',
      endpoint: `jobs/gb/search/${page + 1}`,
      status: 200,
      ms: 1,
    });
    const error = this.searchError?.(this.searches.length);
    if (error) throw error;
    const hits = this.pages[page] ?? [];
    const refs: RawJobRef[] = hits.map((h) => ({
      sourceJobId: String(h.id),
      title: h.title,
      url: h.redirect_url,
      employerName: h.company.display_name,
      location: h.location.display_name,
      postedAt: h.created,
      applicationsCount: null,
      raw: h,
    }));
    return { refs, total: this.pages.flat().length, hasMore: page + 1 < this.pages.length };
  }

  async details(sourceJobId: string): Promise<RawJob> {
    throw new AppError('NOT_FOUND', `No separate advert for ${sourceJobId}`, { retryable: false });
  }

  normalise(raw: RawJob, ctx: NormaliseContext): NormalisedJob {
    return normaliseAdzunaJob(AdzunaResultSchema.parse(raw.raw), ctx);
  }
}
