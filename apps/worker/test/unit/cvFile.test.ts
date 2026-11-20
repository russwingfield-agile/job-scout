import { describe, expect, it } from 'vitest';
import {
  CV_MIME_TYPES,
  checkCvUpload,
  detectCvFileKind,
  labelFromFilename,
  sanitiseFilename,
} from '../../src/core/cvFile.js';

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = new TextEncoder().encode('%PDF-1.7 body');
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 9);
const MB5 = 5 * 1024 * 1024;

describe('detectCvFileKind', () => {
  it.each([
    ['a PDF', PDF, 'pdf'],
    ['a zip/DOCX', ZIP, 'docx'],
    ['text', new TextEncoder().encode('hello world'), null],
    ['a Windows executable', bytes(0x4d, 0x5a, 0x90), null],
    ['a truncated PDF header', new TextEncoder().encode('%PDF'), null],
    ['an empty buffer', new Uint8Array(), null],
  ])('%s → %s', (_label, input, expected) => {
    expect(detectCvFileKind(input)).toBe(expected);
  });
});

describe('checkCvUpload', () => {
  const ok = (mime: string, data: Uint8Array) =>
    checkCvUpload({ mime, size: data.length, bytes: data }, MB5);

  it('accepts matching type and contents', () => {
    expect(ok(CV_MIME_TYPES.pdf, PDF)).toEqual({ ok: true, kind: 'pdf' });
    expect(ok(CV_MIME_TYPES.docx, ZIP)).toEqual({ ok: true, kind: 'docx' });
  });

  it('trusts the contents when the browser sends a generic type', () => {
    expect(ok('application/octet-stream', ZIP)).toEqual({ ok: true, kind: 'docx' });
    expect(ok('', PDF)).toEqual({ ok: true, kind: 'pdf' });
  });

  it.each([
    ['an empty file', { mime: CV_MIME_TYPES.pdf, size: 0, bytes: new Uint8Array() }, 'empty'],
    [
      'an oversized file',
      { mime: CV_MIME_TYPES.pdf, size: MB5 + 1, bytes: PDF },
      'larger than 5 MB',
    ],
    ['an unsupported type', { mime: 'image/png', size: 4, bytes: PDF }, 'Only PDF and DOCX'],
    ['a legacy .doc', { mime: 'application/msword', size: 4, bytes: PDF }, 'Only PDF and DOCX'],
    [
      'contents that are not a document',
      { mime: CV_MIME_TYPES.pdf, size: 4, bytes: bytes(1, 2, 3, 4) },
      'do not look like',
    ],
    [
      'a declared PDF that is really a zip',
      { mime: CV_MIME_TYPES.pdf, size: 5, bytes: ZIP },
      'do not look like',
    ],
    [
      'a generic type with unknown contents',
      { mime: '', size: 3, bytes: bytes(1, 2, 3) },
      'do not look like',
    ],
  ])('rejects %s', (_label, file, message) => {
    const result = checkCvUpload(file, MB5);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain(message);
  });

  it('applies the size limit it is given', () => {
    expect(checkCvUpload({ mime: CV_MIME_TYPES.pdf, size: 100, bytes: PDF }, 99).ok).toBe(false);
    expect(checkCvUpload({ mime: CV_MIME_TYPES.pdf, size: 100, bytes: PDF }, 100).ok).toBe(true);
  });
});

describe('sanitiseFilename', () => {
  it.each([
    ['Jane Doe CV.pdf', 'Jane_Doe_CV.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\jane\\cv.docx', 'cv.docx'],
    ['résumé (final).pdf', 'r_sum_final_.pdf'],
    ['.hidden', 'hidden'],
    ['', 'cv'],
    ['///', 'cv'],
    ['___', 'cv'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it('bounds the length, keeping the extension end', () => {
    const out = sanitiseFilename(`${'a'.repeat(300)}.pdf`);
    expect(out).toHaveLength(100);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('labelFromFilename', () => {
  it.each([
    ['Jane Doe - Agile Coach.pdf', 'Jane Doe - Agile Coach'],
    ['cv.final.docx', 'cv.final'],
    ['C:\\docs\\My CV.pdf', 'My CV'],
    ['noextension', 'noextension'],
    ['.pdf', 'CV'],
    ['', 'CV'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(labelFromFilename(input)).toBe(expected);
  });

  it('caps the label at 80 characters', () => {
    expect(labelFromFilename(`${'x'.repeat(200)}.pdf`)).toHaveLength(80);
  });
});
