import { z } from 'zod';

/**
 * Adzuna `jobs/{country}/search/{page}` response. Loose on purpose: we read only what we use and
 * ignore the rest, because the shape is documented by example rather than by a schema.
 */
const text = z.string().nullish();
const number = z.number().nullish();

export const AdzunaResultSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  /** A short excerpt of the advert, not the whole text. */
  description: text,
  created: text,
  redirect_url: z.string(),
  company: z.looseObject({ display_name: text }).nullish(),
  location: z.looseObject({ display_name: text, area: z.array(z.string()).nullish() }).nullish(),
  salary_min: number,
  salary_max: number,
  /** "1" when Adzuna guessed the pay rather than the advert stating it. */
  salary_is_predicted: z.union([z.string(), z.number(), z.boolean()]).nullish(),
  contract_type: text,
  contract_time: text,
});
export type AdzunaResult = z.infer<typeof AdzunaResultSchema>;

export const AdzunaSearchResponseSchema = z.looseObject({
  count: z.number(),
  results: z.array(AdzunaResultSchema),
});
export type AdzunaSearchResponse = z.infer<typeof AdzunaSearchResponseSchema>;
