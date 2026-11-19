import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
