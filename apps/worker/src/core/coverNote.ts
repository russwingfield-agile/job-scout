export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Tidy what the model returned: drop a leading "Here is…" line, surrounding quotes and markdown
 * emphasis, so what is stored is just the note.
 */
export function cleanNote(raw: string): string {
  let text = raw.trim();
  const lines = text.split('\n');
  if (lines.length > 1 && /^(here('s| is)|sure|certainly)\b.*:\s*$/i.test(lines[0] ?? '')) {
    text = lines.slice(1).join('\n').trim();
  }
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  if (/^["“].*["”]$/s.test(text)) text = text.slice(1, -1).trim();
  return text;
}

/**
 * Hold the note to its word limit. If it runs over, cut at the last full sentence that fits; if no
 * sentence fits, cut at the word limit. Paragraph breaks are kept.
 */
export function limitWords(text: string, maxWords: number): string {
  if (wordCount(text) <= maxWords) return text;
  const words = text.split(/(\s+)/); // keeps the whitespace so paragraphs survive
  let kept = '';
  let count = 0;
  for (const part of words) {
    if (part.trim() === '') {
      kept += part;
      continue;
    }
    if (count === maxWords) break;
    kept += part;
    count++;
  }
  kept = kept.trimEnd();
  const lastStop = Math.max(
    kept.lastIndexOf('. '),
    kept.lastIndexOf('.\n'),
    kept.lastIndexOf('! '),
    kept.lastIndexOf('? '),
  );
  const atSentence = lastStop > kept.length / 2 ? kept.slice(0, lastStop + 1) : kept;
  return atSentence.trimEnd();
}

/** Phrases a cover note must not contain (SPEC §9.2: no clichés). Used to check, and in the prompt. */
export const BANNED_PHRASES = [
  'I am writing to express',
  'passionate',
  'synergy',
  'team player',
  'dynamic',
  'go-getter',
] as const;
