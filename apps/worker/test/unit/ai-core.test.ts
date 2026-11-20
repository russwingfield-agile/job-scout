import type { CvSummary } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { buildCvSummaryPrompt, CV_SUMMARY_PROMPT_VERSION } from '../../src/ai/prompts/cvSummary.js';
import { NEURON_RATES, neuronRateFor } from '../../src/config/neuronRates.js';
import { cvEmbeddingText, EMBED_MAX_CHARS } from '../../src/core/embedText.js';
import { parseLlmJson } from '../../src/core/llmJson.js';
import { approxTokens, estimateNeurons } from '../../src/core/neurons.js';

const summary: CvSummary = {
  headline: 'Enterprise Agile Coach',
  seniority: 'senior',
  yearsExperience: 12,
  skills: ['SAFe', 'Kanban'],
  sectors: ['Banking'],
  suggestedTitles: ['Agile Coach'],
  suggestedKeywords: ['SAFe'],
};

describe('parseLlmJson', () => {
  it.each([
    ['plain JSON', '{"a":1}', { a: 1 }],
    ['padded JSON', '  \n{"a":1}\n ', { a: 1 }],
    ['a json fence', '```json\n{"a":1}\n```', { a: 1 }],
    ['an untagged fence', '```\n{"a":1}\n```', { a: 1 }],
    ['a fence amid prose', 'Sure!\n```json\n{"a":1}\n```\nDone.', { a: 1 }],
    ['JSON inside prose', 'Here is the result: {"a":1} — enjoy', { a: 1 }],
    ['an array', '[1,2]', [1, 2]],
  ])('reads %s', (_label, text, expected) => {
    expect(parseLlmJson(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['prose only', 'I cannot do that'],
    ['truncated JSON', '{"a":1, "b":'],
    ['empty text', ''],
    ['braces that are not JSON', 'use {curly} braces'],
  ])('fails on %s with a reason', (_label, text) => {
    const r = parseLlmJson(text);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error.length).toBeGreaterThan(0);
  });
});

describe('neuron estimates', () => {
  it('approximates tokens at 4 characters each, rounding up', () => {
    expect(approxTokens('')).toBe(0);
    expect(approxTokens('abcd')).toBe(1);
    expect(approxTokens('abcde')).toBe(2);
  });

  it('prices input and output separately and rounds up', () => {
    const rate = NEURON_RATES['@cf/meta/llama-3.3-70b-instruct-fp8-fast'] as never;
    expect(estimateNeurons(rate, 1_000_000, 0)).toBe(26_668);
    expect(estimateNeurons(rate, 0, 1_000_000)).toBe(204_805);
    expect(estimateNeurons(rate, 1_000, 200)).toBe(68);
    expect(estimateNeurons(rate, 1, 0)).toBe(1);
    expect(estimateNeurons(rate, 0, 0)).toBe(0);
  });

  it('costs an unknown model like the most expensive known one', () => {
    expect(neuronRateFor('@cf/some/new-model')).toEqual(
      NEURON_RATES['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    );
    expect(neuronRateFor('@cf/baai/bge-base-en-v1.5').outPerMillion).toBe(0);
  });
});

describe('cvEmbeddingText', () => {
  it('leads with the summary signal, then the CV text', () => {
    const text = cvEmbeddingText({ label: 'Agile Coach', textMd: '  Jane Doe CV  ', summary });
    expect(text.split('\n')).toEqual([
      'Enterprise Agile Coach',
      'Seniority: senior',
      'Skills: SAFe, Kanban',
      'Sectors: Banking',
      'Roles: Agile Coach',
      'Jane Doe CV',
    ]);
  });

  it('falls back to the label when there is no summary', () => {
    expect(cvEmbeddingText({ label: 'Scrum Master', textMd: 'cv text', summary: null })).toBe(
      'Scrum Master\ncv text',
    );
  });

  it('truncates to the embedding budget', () => {
    const text = cvEmbeddingText({ label: 'x', textMd: 'y'.repeat(10_000), summary: null });
    expect(text).toHaveLength(EMBED_MAX_CHARS);
  });
});

describe('buildCvSummaryPrompt', () => {
  it('is versioned and carries the CV text', () => {
    const p = buildCvSummaryPrompt('  Jane Doe, Agile Coach  ');
    expect(p.version).toBe(CV_SUMMARY_PROMPT_VERSION);
    expect(p.version).toMatch(/^cvSummary@\d+$/);
    expect(p.user).toContain('Jane Doe, Agile Coach');
    expect(p.system).toContain('Never invent');
  });

  it('truncates very long CVs', () => {
    const p = buildCvSummaryPrompt('z'.repeat(50_000));
    expect(p.user.length).toBeLessThan(16_100);
  });

  it('asks for every summary field', () => {
    const { system } = buildCvSummaryPrompt('x');
    for (const field of [
      'headline',
      'seniority',
      'yearsExperience',
      'skills',
      'sectors',
      'suggestedTitles',
      'suggestedKeywords',
    ]) {
      expect(system).toContain(field);
    }
  });
});
