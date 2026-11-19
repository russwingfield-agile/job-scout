import { z } from 'zod';
import { EmploymentTypeSchema, Ir35Schema, PayPeriodSchema, WorkModeSchema } from './enums.js';

/** Source-agnostic job shape (SPEC §4.4). Everything downstream of the adapter uses only this. */
export const NormalisedJobSchema = z.object({
  source: z.string().min(1),
  sourceJobId: z.string().min(1),
  url: z.string(),
  externalApplyUrl: z.string().optional(),
  title: z.string(),
  employerName: z.string(),
  isAgency: z.boolean().nullable(),
  location: z.string(),
  workMode: WorkModeSchema,
  onsiteDaysPerWeek: z.number().optional(),
  employmentType: EmploymentTypeSchema,
  salaryText: z.string().optional(),
  payMin: z.number().optional(),
  payMax: z.number().optional(),
  payPeriod: PayPeriodSchema,
  currency: z.literal('GBP'),
  ir35: Ir35Schema.optional(),
  contractLengthMonths: z.number().optional(),
  postedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
  descriptionHtml: z.string(),
  descriptionText: z.string(),
  applicationsCount: z.number().int().optional(),
});
export type NormalisedJob = z.infer<typeof NormalisedJobSchema>;
