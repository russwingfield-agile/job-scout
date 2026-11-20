import { z } from 'zod';
import { EmploymentTypeSchema } from './enums.js';
import { SettingsPatchSchema, SettingsSchema } from './settings.js';

/** Error envelope returned by every failing /api route (IMPLEMENTATION_PLAN §2.7). */
export const ApiErrorCodeSchema = z.enum([
  'VALIDATION',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'UPSTREAM_RATE_LIMIT',
  'UPSTREAM_ERROR',
  'BUDGET_EXHAUSTED',
  'LLM_INVALID_OUTPUT',
  'CONFLICT',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** POST /api/dev/reed-probe (dev only): run a real Reed search and normalise the first few hits. */
export const ReedProbeRequestSchema = z.object({
  keywords: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(100).nullable().default(null),
  radiusMiles: z.number().int().min(0).max(200).default(25),
  employmentTypes: z.array(EmploymentTypeSchema).default(['contract', 'permanent']),
  minSalary: z.number().int().min(0).nullable().default(null),
  page: z.number().int().min(0).max(50).default(0),
  /** How many hits to fetch full details for (each costs one Reed call). */
  detailsCount: z.number().int().min(0).max(5).default(3),
});
export type ReedProbeRequest = z.input<typeof ReedProbeRequestSchema>;

export const GetSettingsResponseSchema = SettingsSchema;
export const UpdateSettingsRequestSchema = SettingsPatchSchema;
export const UpdateSettingsResponseSchema = SettingsSchema;
