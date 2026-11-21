import { EmploymentTypeSchema } from '@job-scout/shared';
import { z } from 'zod';

/**
 * Retries the queue allows before a message is given up on. Must equal `max_retries` in
 * wrangler.jsonc: on the final attempt the handler records the failure and completes the message
 * itself, so a failing message can never leave its run waiting forever.
 */
export const QUEUE_MAX_RETRIES = 3;

const SearchQuerySchema = z.object({
  keywords: z.string(),
  location: z.string().nullable(),
  radiusMiles: z.number(),
  employmentTypes: z.array(EmploymentTypeSchema),
  minSalary: z.number().nullable(),
});

/** One page of one search. `profileIds` are all profiles that asked for this exact query. */
export const FetchMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('fetch'),
  runId: z.string(),
  /** Which job source to search. Messages queued before there were several are Reed's. */
  source: z.string().default('reed'),
  profileIds: z.array(z.string()).min(1),
  queryKey: z.string(),
  query: SearchQuerySchema,
  page: z.number().int().min(0),
});

/** Fetch details for, normalise, filter, embed and prefilter-score one job. */
export const ProcessMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('process'),
  runId: z.string(),
  jobId: z.string(),
});

/** Assess one job group with the LLM and compute its final score. */
export const ScoreMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('score'),
  runId: z.string(),
  groupId: z.string(),
});

export const PipelineMessageSchema = z.discriminatedUnion('type', [
  FetchMessageSchema,
  ProcessMessageSchema,
  ScoreMessageSchema,
]);

export type FetchMessage = z.infer<typeof FetchMessageSchema>;
export type ProcessMessage = z.infer<typeof ProcessMessageSchema>;
export type ScoreMessage = z.infer<typeof ScoreMessageSchema>;
export type PipelineMessage = z.infer<typeof PipelineMessageSchema>;

/** Keys for the exactly-once counter claims. `enq:` keys guard enqueueing, the others completion. */
export const enqueueFetchKey = (runId: string, queryKey: string, page: number): string =>
  `enq:fetch:${runId}:${queryKey}:${page}`;
export const enqueueProcessKey = (runId: string, jobId: string): string =>
  `enq:process:${runId}:${jobId}`;
export const enqueueScoreKey = (runId: string, groupId: string): string =>
  `enq:score:${runId}:${groupId}`;
export const completionKey = (m: PipelineMessage): string => {
  switch (m.type) {
    case 'fetch':
      return `done:fetch:${m.runId}:${m.queryKey}:${m.page}`;
    case 'process':
      return `done:process:${m.runId}:${m.jobId}`;
    case 'score':
      return `done:score:${m.runId}:${m.groupId}`;
  }
};
