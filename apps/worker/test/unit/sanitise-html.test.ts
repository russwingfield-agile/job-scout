import { describe, expect, it } from 'vitest';
import { sanitiseHtml } from '../../src/core/sanitiseHtml.js';

describe('sanitiseHtml', () => {
  it.each([
    [
      'keeps basic formatting',
      '<p>Hello <strong>there</strong></p><ul><li>One</li></ul>',
      '<p>Hello <strong>there</strong></p><ul><li>One</li></ul>',
    ],
    [
      'lowercases tags and drops their attributes',
      '<P CLASS="x" onclick="evil()">Hi</P>',
      '<p>Hi</p>',
    ],
    [
      'removes scripts and styles with their contents',
      'A<script>alert(1)</script>B<style>p{}</style>C',
      'ABC',
    ],
    [
      'removes frames, objects and embeds',
      'x<iframe src="//evil"></iframe>y<object data="a"></object>z',
      'xyz',
    ],
    ['removes comments', 'a<!-- <script>x</script> -->b', 'ab'],
    [
      'drops tags that are not allowed but keeps their text',
      '<font color="red">Red</font> <img src=x onerror=alert(1)>text',
      'Red text',
    ],
    [
      'keeps an http link and makes it open safely',
      '<a href="https://example.com/a?b=1&c=2" onclick="x()">Go</a>',
      '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">Go</a>',
    ],
    [
      'strips a javascript: link but keeps the words',
      '<a href="javascript:alert(1)">Click</a>',
      '<a>Click</a>',
    ],
    ['strips a data: link', '<a href="data:text/html;base64,AAAA">Click</a>', '<a>Click</a>'],
    ['treats a stray less-than as text', '5 < 6 and <p>ok</p>', '5 &lt; 6 and <p>ok</p>'],
    ['handles an empty string', '', ''],
  ])('%s', (_name, input, expected) => {
    expect(sanitiseHtml(input)).toBe(expected);
  });

  it('never lets an event handler or script through, however it is disguised', () => {
    const nasty = [
      '<SCRIPT SRC=//evil></SCRIPT>',
      '<p onmouseover=alert(1)>x</p>',
      '<a href=" javascript:alert(1)">x</a>',
      '<svg/onload=alert(1)>',
      '<img src="x" onerror="alert(1)">',
      '<scr<script>ipt>alert(1)</script>',
    ];
    for (const input of nasty) {
      const out = sanitiseHtml(input);
      expect(out.toLowerCase()).not.toMatch(
        /<script|onerror|onload|onmouseover|javascript:|<svg|<img/,
      );
    }
  });
});
