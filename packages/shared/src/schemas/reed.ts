import { z } from 'zod';

const nullableNumber = z.number().nullish();
const nullableString = z.string().nullish();

/**
 * Reed `jobs/{id}` response. Loose on purpose: unknown fields pass through and nearly everything is
 * optional, so an API change degrades parsing instead of breaking ingest. Field names follow
 * SPEC §4.1 and are verified against real responses in M3 (see docs/DECISIONS.md).
 */
export const ReedJobDetailsSchema = z.looseObject({
  jobId: z.number(),
  employerId: nullableNumber,
  employerName: z.string().default(''),
  jobTitle: z.string().default(''),
  locationName: z.string().default(''),
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
  jobDescription: z.string().default(''),
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
