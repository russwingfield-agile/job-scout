import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { DocParser } from '../../ports/docparse.js';
import { type AiLike, toAiError } from './binding.js';

// `format` is 'markdown' | 'text' | 'error'; failed files carry `error` instead of `data`.
const ConversionResults = z.array(
  z.looseObject({
    name: z.string().nullish(),
    format: z.string(),
    data: z.string().nullish(),
    error: z.string().nullish(),
  }),
);

export class WorkersAiDocParser implements DocParser {
  constructor(private readonly ai: AiLike) {}

  async toMarkdown(file: { name: string; bytes: ArrayBuffer; mime: string }): Promise<string> {
    let raw: unknown;
    try {
      raw = await this.ai.toMarkdown([
        { name: file.name, blob: new Blob([file.bytes], { type: file.mime }) },
      ]);
    } catch (err) {
      throw toAiError(err, 'document conversion');
    }

    const result = ConversionResults.safeParse(raw);
    const first = result.success ? result.data[0] : undefined;
    if (!first) {
      throw new AppError('UPSTREAM_ERROR', 'Unexpected document conversion response', {
        retryable: false,
      });
    }
    if (first.format === 'error') {
      // The document itself is unreadable (corrupt, encrypted, scanned): the user's problem, not ours.
      throw new AppError(
        'VALIDATION',
        `Could not read this document${first.error ? `: ${first.error}` : ''}`,
        { retryable: false },
      );
    }
    return first.data ?? '';
  }
}
