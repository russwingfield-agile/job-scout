/** Tags an advert may keep. Everything else is dropped (its text stays). */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'div',
  'span',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
]);

/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT =
  /<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
const HREF = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

const escapeAttribute = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Keep only basic formatting from an advert's HTML before it is stored (SPEC §13): an allow-list
 * of tags with no attributes, except links, which keep an http(s) address and always open safely.
 * Scripts, styles, frames, comments, event handlers and `javascript:` links cannot get through.
 * Defence in depth: the app shows adverts as plain text, but stored HTML should be safe on its own.
 */
export function sanitiseHtml(html: string): string {
  const stripped = html.replace(COMMENTS, '').replace(DROP_WITH_CONTENT, '');
  return stripped
    .replace(TAG, (match, rawName: string, attrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      if (match.startsWith('</')) return `</${name}>`;
      if (name === 'a') {
        const m = HREF.exec(attrs);
        const href = (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').trim();
        return /^https?:\/\//i.test(href)
          ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`
          : '<a>';
      }
      return `<${name}>`;
    })
    .replace(/<(?![a-zA-Z/])/g, '&lt;'); // a stray "<" is text, not a tag
}
