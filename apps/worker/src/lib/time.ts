/** ISO-8601 UTC string, the storage format for every timestamp. */
export const toIso = (d: Date): string => d.toISOString();

/** UTC calendar day (YYYY-MM-DD), the key for `usage_daily`. */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
