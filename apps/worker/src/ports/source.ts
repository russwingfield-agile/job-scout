import type { EmploymentType, NormalisedJob } from '@job-scout/shared';
import type { NormaliseContext } from '../core/normalise.js';

/** Source-agnostic search request, built from a search profile (one keyword × one location). */
export type SearchQuery = {
  keywords: string;
  /** null = no location filter (e.g. a "Remote" profile location). */
  location: string | null;
  radiusMiles: number;
  employmentTypes: EmploymentType[];
  /** Only meaningful for permanent-only searches; sources compare it against annual pay. */
  minSalary: number | null;
};

/** A search hit: just enough to dedupe by id and decide whether to fetch the full advert. */
export type RawJobRef = {
  sourceJobId: string;
  title: string;
  url: string;
  employerName: string;
  location: string;
  postedAt: string | null;
  applicationsCount: number | null;
  /**
   * The whole advert, for sources whose search already returns it (see `inlineDetails`). Stored
   * as `jobs.raw_json` so no second request is needed.
   */
  raw?: unknown;
};

/** The source's full advert, kept verbatim (stored as `jobs.raw_json`). */
export type RawJob = { sourceJobId: string; raw: unknown };

export type SourceCallContext = { runId?: string | undefined };

export interface SourceAdapter {
  readonly id: string;
  /**
   * True when search results carry the advert itself, so there is no per-advert request (and no
   * request budget to spend on it). The text is then usually only an excerpt of the full advert.
   */
  readonly inlineDetails?: boolean;
  /** `page` is zero-based. */
  search(
    q: SearchQuery,
    page: number,
    ctx?: SourceCallContext,
  ): Promise<{ refs: RawJobRef[]; total: number; hasMore: boolean }>;
  details(sourceJobId: string, ctx?: SourceCallContext): Promise<RawJob>;
  normalise(raw: RawJob, ctx: NormaliseContext): NormalisedJob;
}
