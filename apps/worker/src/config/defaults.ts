import type { Settings } from '@job-scout/shared';

/**
 * Typed defaults for every tunable value (SPEC §3.3, §5, §7, §8, §10, §11).
 * Stored overrides in the `settings` table are merged over these; never inline these numbers.
 * Model IDs are config, not code — confirm against the Workers AI catalogue (SPEC §3.3).
 */
export const DEFAULT_SETTINGS: Settings = {
  schedule: {
    timezone: 'Europe/London',
    'mon-fri': ['07:00', '12:00', '17:00'],
    sat: [],
    sun: ['17:00'],
  },
  weights: {
    finalFit: 0.75,
    finalPrefilterSim: 0.2,
    finalFreshness: 0.05,
    simLow: 0.55,
    simHigh: 0.85,
    bonusTitleMatch: 5,
    bonusPayDisclosed: 3,
    bonusIr35Outside: 3,
    freshnessTiers: [
      { maxHours: 24, score: 100 },
      { maxHours: 72, score: 70 },
      { maxHours: 168, score: 40 },
    ],
    freshnessFloor: 10,
  },
  thresholds: {
    prefilterMin: 55,
    badgeStrong: 80,
    badgeGood: 65,
    badgeMaybe: 50,
  },
  budgets: {
    maxLlmPerRun: 30,
    maxPagesPerQuery: 3,
    reedDailyRequestBudget: 900,
    // Three runs a day × 250 stays inside the daily budget; the first run on an empty database
    // needs far more than the ~60 the original spec assumed for a steady-state run.
    reedCallsPerRunCap: 250,
    // ASSUMPTION: Workers AI free allocation is 10,000 neurons/day; verify and adjust in Settings.
    aiDailyNeuronBudget: 10_000,
    fallbackModelAtFraction: 0.8,
    staleRunMinutes: 30,
  },
  ingest: { maxAgeDays: 7 },
  models: {
    embedding: '@cf/baai/bge-base-en-v1.5',
    embeddingDims: 768,
    scoring: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    fallback: '@cf/meta/llama-3.1-8b-instruct',
    coverNote: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  },
  dedupe: {
    similarity: 0.92,
    titleTokenSetRatio: 0.8,
    payBandTolerance: 0.1,
    lookbackDays: 21,
    topK: 5,
  },
  feedback: {
    agencySpamSkips: 3,
    agencySpamPenalty: -10,
    previousApplyBonus: 5,
    appliedSimilarityThreshold: 0.88,
    appliedSimilarityBonus: 5,
    skippedSimilarityThreshold: 0.9,
    skippedSimilarityPenalty: -5,
    recentVectorCount: 50,
    suggestionMinSkips: 5,
    suggestionWindowDays: 14,
    suggestionRateBuffer: 50,
  },
  assessment: {
    maxJobTokens: 3500,
    maxCvTokens: 2000,
    fullTextCvCount: 2,
  },
  coverNotes: { noteWords: 200, messageWords: 90, maxJobTokens: 3000, maxCvTokens: 3000 },
  blocklist: { employers: [], agencies: [], keywords: [] },
  working: { workingDaysPerYear: 220, hoursPerDay: 8 },
  retention: { filteredDays: 30 },
  cvs: {
    maxActive: 4,
    maxUploadBytes: 5 * 1024 * 1024,
    profileDefaults: {
      radiusMiles: 25,
      locations: ['London', 'Remote'],
      employmentTypes: ['contract', 'permanent'],
    },
  },
};
