const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  pound: '£',
  euro: '€',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  hellip: '…',
  copy: '©',
};

const MAX_CODE_POINT = 0x10ffff;

const fromCodePoint = (cp: number, original: string): string =>
  cp > 0 && cp <= MAX_CODE_POINT ? String.fromCodePoint(cp) : original;

/** Decode numeric (`&#163;`, `&#xA3;`) and common named HTML entities. Unknown entities stay as-is. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (m, dec: string) => fromCodePoint(Number.parseInt(dec, 10), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => fromCodePoint(Number.parseInt(hex, 16), m))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * HTML → plain text without a DOM (Workers have none). Block elements become line breaks, list
 * items become "- " bullets, tags are dropped, entities decoded, whitespace collapsed.
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|tr|table|section|article)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(stripped)
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
