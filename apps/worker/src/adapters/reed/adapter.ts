import {
  type NormalisedJob,
  ReedJobDetailsSchema,
  ReedSearchResponseSchema,
  type ReedSearchResult,
} from '@job-scout/shared';
import { type NormaliseContext, normaliseReedJob } from '../../core/normalise.js';
import { parseSourceDate } from '../../core/parse/date.js';
import { AppError } from '../../lib/errors.js';
import type {
  RawJob,
  RawJobRef,
  SearchQuery,
  SourceAdapter,
  SourceCallContext,
} from '../../ports/source.js';
import type { ReedHttp } from './client.js';
import { buildSearchParams } from './query.js';

const jobUrl = (r: { jobId: number; jobUrl?: string | null | undefined }): string =>
  r.jobUrl ?? `https://www.reed.co.uk/jobs/${r.jobId}`;

function toRef(r: ReedSearchResult): RawJobRef {
  return {
    sourceJobId: String(r.jobId),
    title: r.jobTitle,
    url: jobUrl(r),
    employerName: r.employerName,
    location: r.locationName,
    postedAt: parseSourceDate(r.date),
    applicationsCount: r.applications ?? null,
  };
}

export class ReedAdapter implements SourceAdapter {
  readonly id = 'reed';

  constructor(private readonly http: ReedHttp) {}

  async search(
    q: SearchQuery,
    page: number,
    ctx?: SourceCallContext,
  ): Promise<{ refs: RawJobRef[]; total: number }> {
    const res = await this.http.get(
      'search',
      buildSearchParams(q, page),
      ReedSearchResponseSchema,
      ctx,
    );
    return { refs: res.results.map(toRef), total: res.totalResults };
  }

  async details(sourceJobId: string, ctx?: SourceCallContext): Promise<RawJob> {
    const raw = await this.http.get(
      `jobs/${encodeURIComponent(sourceJobId)}`,
      {},
      ReedJobDetailsSchema,
      ctx,
    );
    // Reed answers 200 with a blank record (jobId 0, null fields) for an unknown or expired id.
    if (raw.jobId === 0 || raw.jobTitle === '') {
      throw new AppError('NOT_FOUND', `Reed job ${sourceJobId} not found`, { retryable: false });
    }
    return { sourceJobId, raw };
  }

  normalise(raw: RawJob, ctx: NormaliseContext): NormalisedJob {
    return normaliseReedJob(ReedJobDetailsSchema.parse(raw.raw), ctx);
  }
}
