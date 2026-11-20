import { z } from 'zod';

const nullableNumber = z.number().nullish();
const nullableString = z.string().nullish();
/** Reed sends `null` for missing text (and blank records for unknown ids); read both as ''. */
const text = z
  .string()
  .nullish()
  .transform((v) => v ?? '');

/**
 * Reed `jobs/{id}` response, verified against the live API on 2026-11-20 (see docs/DECISIONS.md).
 * Loose on purpose: unknown fields pass through and nearly everything is optional, so an API change
 * degrades parsing instead of breaking ingest. Reed answers HTTP 200 with a blank record
 * (`jobId: 0`, null fields) for an unknown id — callers must check `jobId`.
 */
export const ReedJobDetailsSchema = z.looseObject({
  jobId: z.number(),
  employerId: nullableNumber,
  employerName: text,
  jobTitle: text,
  locationName: text,
  minimumSalary: nullableNumber,
  maximumSalary: nullableNumber,
  yearlyMinimumSalary: nullableNumber,
  yearlyMaximumSalary: nullableNumber,
  currency: nullableString,
  salary: nullableString,
  salaryType: nullableString,
  expirationDate: nullableString,
  date: nullableString,
  datePosted: nullableString,
  jobDescription: text,
  applicationCount: nullableNumber,
  applications: nullableNumber,
  jobUrl: nullableString,
  externalUrl: nullableString,
  contractType: nullableString,
  jobType: nullableString,
  fullTime: z.boolean().nullish(),
  partTime: z.boolean().nullish(),
});
export type ReedJobDetails = z.infer<typeof ReedJobDetailsSchema>;

/** One entry of `search` results (a snippet; the full advert needs `jobs/{id}`). */
export const ReedSearchResultSchema = z.looseObject({
  jobId: z.number(),
  employerId: nullableNumber,
  employerName: text,
  jobTitle: text,
  locationName: text,
  minimumSalary: nullableNumber,
  maximumSalary: nullableNumber,
  currency: nullableString,
  expirationDate: nullableString,
  date: nullableString,
  jobDescription: text,
  applications: nullableNumber,
  jobUrl: nullableString,
});
export type ReedSearchResult = z.infer<typeof ReedSearchResultSchema>;

export const ReedSearchResponseSchema = z.looseObject({
  results: z.array(ReedSearchResultSchema),
  totalResults: z.number(),
  ambiguousLocations: z.array(z.unknown()).default([]),
});
export type ReedSearchResponse = z.infer<typeof ReedSearchResponseSchema>;
