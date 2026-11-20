const BASE_SECONDS = 10;
const MAX_SECONDS = 300;

/**
 * Queue retry delay: min(300, 10·2^attempt) seconds plus up to 20% jitter (plan §2.3), so retries
 * of a burst of failures do not all land on the upstream at once. `random` is injectable for tests.
 */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_SECONDS, BASE_SECONDS * 2 ** attempt);
  return Math.round(base + base * 0.2 * random());
}
