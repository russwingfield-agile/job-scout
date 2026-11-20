export type JsonParse = { ok: true; value: unknown } | { ok: false; error: string };

const FENCE = /```(?:json)?\s*([\s\S]*?)\s*```/i;

function attempt(text: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Extract a JSON value from LLM output. Models often wrap JSON in a ```json fence or add a
 * sentence around it, so try the fenced body, then the whole text, then the outermost {...}.
 */
export function parseLlmJson(text: string): JsonParse {
  const trimmed = text.trim();
  const fenced = FENCE.exec(trimmed);
  const body = fenced ? (fenced[1] as string) : trimmed;

  const direct = attempt(body);
  if (direct.ok) return direct;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const inner = attempt(body.slice(start, end + 1));
    if (inner.ok) return inner;
  }
  return direct;
}
