import { z } from 'zod';
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

export const GetSettingsResponseSchema = SettingsSchema;
export const UpdateSettingsRequestSchema = SettingsPatchSchema;
export const UpdateSettingsResponseSchema = SettingsSchema;
