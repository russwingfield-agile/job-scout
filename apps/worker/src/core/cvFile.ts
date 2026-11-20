export type CvFileKind = 'pdf' | 'docx';

export const CV_MIME_TYPES: Record<CvFileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a DOCX is a zip archive

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  magic.every((b, i) => bytes[i] === b);

/** What the first bytes say the file is. Authoritative: a renamed .exe is neither. */
export function detectCvFileKind(bytes: Uint8Array): CvFileKind | null {
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  return null;
}

export type UploadCheck = { ok: true; kind: CvFileKind } | { ok: false; error: string };

const GENERIC_MIME = new Set(['', 'application/octet-stream']);

/**
 * Validate an uploaded CV: non-empty, within the size limit, a PDF or DOCX by declared type, and
 * its contents must really be that type (magic bytes). Browsers sometimes label a DOCX as
 * octet-stream, so a generic type defers to the sniffed one.
 */
export function checkCvUpload(
  file: { mime: string; size: number; bytes: Uint8Array },
  maxBytes: number,
): UploadCheck {
  if (file.size === 0) return { ok: false, error: 'The file is empty.' };
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }

  const declared = (Object.keys(CV_MIME_TYPES) as CvFileKind[]).find(
    (k) => CV_MIME_TYPES[k] === file.mime,
  );
  if (!declared && !GENERIC_MIME.has(file.mime)) {
    return { ok: false, error: 'Only PDF and DOCX files are supported.' };
  }

  const sniffed = detectCvFileKind(file.bytes);
  if (!sniffed || (declared && declared !== sniffed)) {
    return { ok: false, error: 'The file contents do not look like a PDF or DOCX document.' };
  }
  return { ok: true, kind: sniffed };
}

const MAX_FILENAME_LENGTH = 100;

/** Safe object-key segment: base name only, `[A-Za-z0-9._-]`, bounded length, never empty. */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-MAX_FILENAME_LENGTH);
  return cleaned || 'cv';
}

/** "Jane_Doe-Agile Coach CV.pdf" → "Jane_Doe-Agile Coach CV" (default label for an upload). */
export function labelFromFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return (base || 'CV').slice(0, 80);
}
