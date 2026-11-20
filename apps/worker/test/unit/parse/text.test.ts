import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from '../../../src/core/parse/text.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('&pound;600 &amp; &#163;700 &#xA3;800 &ndash; caf&eacute;')).toBe(
      '£600 & £700 £800 – caf&eacute;',
    );
  });

  it('is case-insensitive for names and hex digits', () => {
    expect(decodeEntities('&AMP; &#XA3;')).toBe('& £');
  });

  it('leaves out-of-range numeric entities untouched', () => {
    expect(decodeEntities('&#0; &#99999999;')).toBe('&#0; &#99999999;');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
  });

  it('does not double-decode', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&amp;#163;')).toBe('&#163;');
  });
});

describe('htmlToText', () => {
  it('turns block elements into line breaks and list items into bullets', () => {
    const html = '<h2>Role</h2><p>Lead the team.</p><ul><li>SAFe</li><li>Kanban</li></ul>';
    expect(htmlToText(html)).toBe('Role\nLead the team.\n\n- SAFe\n- Kanban');
  });

  it('handles <br>, table cells and inline tags', () => {
    expect(htmlToText('a<br/>b<br>c')).toBe('a\nb\nc');
    expect(htmlToText('<table><tr><td>Rate</td><td>£600</td></tr></table>')).toBe('Rate £600');
    expect(htmlToText('Ag<b>ile</b> <i>Coach</i>')).toBe('Agile Coach');
  });

  it('drops scripts, styles and comments', () => {
    expect(
      htmlToText('<style>p{color:red}</style><script>alert(1)</script><!-- note -->Hello'),
    ).toBe('Hello');
  });

  it('decodes entities after stripping tags so escaped markup stays text', () => {
    expect(htmlToText('&lt;b&gt;bold&lt;/b&gt; &pound;550&nbsp;pd')).toBe('<b>bold</b> £550 pd');
  });

  it('collapses whitespace and blank lines', () => {
    expect(htmlToText('<p>a</p>\n\n\n<p>  b   c </p><div></div><div></div>')).toBe('a\n\nb c');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});
