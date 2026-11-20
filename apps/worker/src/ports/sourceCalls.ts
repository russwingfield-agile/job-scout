export type SourceCall = {
  runId?: string | undefined;
  source: string;
  endpoint: string;
  /** HTTP status, or 0 when no response arrived (network error, timeout). */
  status: number;
  ms: number;
};

/** Records every upstream request for debugging and the daily budget. */
export interface SourceCallRecorder {
  record(call: SourceCall): Promise<void>;
}
