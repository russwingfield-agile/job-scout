import type { Db } from '../client.js';
import { applicationsRepo } from './applications.js';
import { assessmentsRepo } from './assessments.js';
import { coverNotesRepo } from './coverNotes.js';
import { cvsRepo } from './cvs.js';
import { groupsRepo } from './groups.js';
import { jobsRepo } from './jobs.js';
import { profilesRepo } from './profiles.js';
import { runsRepo } from './runs.js';
import { settingsRepo } from './settings.js';
import { sourceCallsRepo } from './sourceCalls.js';
import { usageRepo } from './usage.js';
import { vectorsRepo } from './vectors.js';

export function createRepos(db: Db) {
  return {
    settings: settingsRepo(db),
    runs: runsRepo(db),
    jobs: jobsRepo(db),
    groups: groupsRepo(db),
    cvs: cvsRepo(db),
    profiles: profilesRepo(db),
    assessments: assessmentsRepo(db),
    applications: applicationsRepo(db),
    coverNotes: coverNotesRepo(db),
    usage: usageRepo(db),
    sourceCalls: sourceCallsRepo(db),
    vectors: vectorsRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;
