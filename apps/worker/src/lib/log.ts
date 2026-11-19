export type LogFields = {
  runId?: string;
  stage?: string;
  jobId?: string;
  requestId?: string;
  msg: string;
  [extra: string]: unknown;
};

export interface Logger {
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
}

/** Structured JSON logs; Workers Logs indexes the fields (IMPLEMENTATION_PLAN §2.6). */
export function createLogger(): Logger {
  const emit = (level: 'info' | 'warn' | 'error', fields: LogFields) => {
    const line = JSON.stringify({ level, ...fields });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    info: (f) => emit('info', f),
    warn: (f) => emit('warn', f),
    error: (f) => emit('error', f),
  };
}
