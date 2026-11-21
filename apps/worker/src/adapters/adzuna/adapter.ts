import {
  AdzunaResultSchema,
  AdzunaSearchResponseSchema,
  type NormalisedJob,
} from '@job-scout/shared';
import type { NormaliseContext } from '../../core/normalise.js';
import { normaliseAdzunaJob } from '../../core/normaliseAdzuna.js';
import { parseSourceDate } from '../../core/parse/date.js';
import { AppError } from '../../lib/errors.js';
import type {
  RawJob,
  RawJobRef,
  SearchQuery,
  SourceAdapter,
  SourceCallContext,
} from '../../ports/source.js';
import type { AdzunaHttp } from './client.js';
import { ADZUNA_PAGE_SIZE, buildAdzunaParams } from './query.js';

/** Country code in Adzuna's URLs. The app searches UK adverts. */
const COUNTRY = 'gb';

/**
 * Adzuna (an aggregator that gathers adverts from many boards). Its search results already carry
 * the advert, only as an excerpt, and there is no per-advert request, so `inlineDetails` is set:
 * the pipeline stores each hit as it arrives and spends no further requests on it.
 */
export class AdzunaAdapter implements SourceAdapter {
  readonly id = 'adzuna';
  readonly inlineDetails = true;

  constructor(private readonly http: AdzunaHttp) {}

  async search(
    q: SearchQuery,
    page: number,
    ctx?: SourceCallContext,
  ): Promise<{ refs: RawJobRef[]; total: number; hasMore: boolean }> {
    const res = await this.http.get(
      `jobs/${COUNTRY}/search/${page + 1}`, // Adzuna pages start at 1
      buildAdzunaParams(q),
      AdzunaSearchResponseSchema,
      ctx,
    );
    return {
      refs: res.results.map((r) => ({
        sourceJobId: String(r.id),
        title: r.title,
        url: r.redirect_url,
        employerName: r.company?.display_name ?? 'Unknown employer',
        location: r.location?.display_name ?? '',
        postedAt: parseSourceDate(r.created),
        applicationsCount: null,
        raw: r,
      })),
      total: res.count,
      hasMore: (page + 1) * ADZUNA_PAGE_SIZE < res.count,
    };
  }

  async details(sourceJobId: string): Promise<RawJob> {
    // Never needed: search results are the whole record (see `inlineDetails`).
    throw new AppError('NOT_FOUND', `Adzuna has no separate advert for ${sourceJobId}`, {
      retryable: false,
    });
  }

  normalise(raw: RawJob, ctx: NormaliseContext): NormalisedJob {
    return normaliseAdzunaJob(AdzunaResultSchema.parse(raw.raw), ctx);
  }
}
