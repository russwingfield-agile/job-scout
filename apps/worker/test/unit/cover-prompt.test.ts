import { describe, expect, it } from 'vitest';
import { buildCoverNotePrompt, COVER_NOTE_PROMPT_VERSION } from '../../src/ai/prompts/coverNote.js';

const base = {
  kind: 'cover_note' as const,
  tone: 'concise' as const,
  maxWords: 200,
  job: {
    title: 'Agile Coach',
    employerName: 'Acme',
    location: 'London',
    payText: '£600/day',
    descriptionText: 'Coach SAFe teams.',
  },
  cvText: 'Jane Doe. Led SAFe rollouts at a bank.',
  strengths: ['SAFe rollout at a bank'],
  maxJobTokens: 3000,
  maxCvTokens: 3000,
};

describe('buildCoverNotePrompt', () => {
  it('is versioned and deterministic', () => {
    expect(buildCoverNotePrompt(base)).toEqual(buildCoverNotePrompt(base));
    expect(buildCoverNotePrompt(base).version).toBe(COVER_NOTE_PROMPT_VERSION);
    expect(COVER_NOTE_PROMPT_VERSION).toBe('coverNote@1');
  });

  it('states the limit, UK spelling, the facts-only rule and the banned phrases', () => {
    const { system } = buildCoverNotePrompt(base);
    expect(system).toContain('at most 200 words');
    expect(system).toContain('UK spelling');
    expect(system).toContain('ONLY facts that appear in the CV');
    expect(system).toContain('passionate');
    expect(system).toContain('call to action');
  });

  it('describes the kind and the tone', () => {
    const msg = buildCoverNotePrompt({
      ...base,
      kind: 'recruiter_message',
      tone: 'formal',
      maxWords: 90,
    });
    expect(msg.system).toContain('short message to send to the recruiter');
    expect(msg.system).toContain('at most 90 words');
    expect(msg.system).toContain('Formal and measured');
  });

  it('includes the advert, strengths and CV, and truncates long text', () => {
    const { user } = buildCoverNotePrompt(base);
    expect(user).toContain('Title: Agile Coach');
    expect(user).toContain('- SAFe rollout at a bank');
    expect(user).toContain('Jane Doe');
    const long = buildCoverNotePrompt({ ...base, cvText: 'x'.repeat(50_000), maxCvTokens: 100 });
    expect(long.user).toContain('[…truncated]');
    expect(long.user.length).toBeLessThan(2_000);
    expect(buildCoverNotePrompt({ ...base, strengths: [] }).user).not.toContain(
      'Strengths to lead with',
    );
  });
});
