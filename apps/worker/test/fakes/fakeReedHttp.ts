import type { ZodType } from 'zod';
import type { ReedHttp, ReedParams } from '../../src/adapters/reed/client.js';
import type { SourceCallContext } from '../../src/ports/source.js';

export type FakeReedCall = {
  endpoint: string;
  params: ReedParams;
  ctx: SourceCallContext | undefined;
};

/**
 * A ReedHttp serving recorded fixtures. Responses still go through the real Zod schema, exactly as
 * the real client would, so a schema/fixture mismatch fails here.
 */
export function fakeReedHttp(fixtures: {
  search?: unknown;
  /** Details responses keyed by Reed job id. */
  details?: Record<string, unknown>;
  /** Served for any details id not listed in `details`. */
  anyDetails?: unknown;
}): ReedHttp & { calls: FakeReedCall[] } {
  const calls: FakeReedCall[] = [];
  return {
    calls,
    async get<T>(
      endpoint: string,
      params: ReedParams,
      schema: ZodType<T>,
      ctx?: SourceCallContext,
    ): Promise<T> {
      calls.push({ endpoint, params, ctx });
      const body =
        endpoint === 'search'
          ? fixtures.search
          : (fixtures.details?.[endpoint.replace(/^jobs\//, '')] ?? fixtures.anyDetails);
      if (body === undefined) throw new Error(`fakeReedHttp: no fixture for ${endpoint}`);
      return schema.parse(body);
    },
  };
}
