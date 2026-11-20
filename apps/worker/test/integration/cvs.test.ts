import { env } from 'cloudflare:workers';
import type { CvDetail, CvListItem, CvMutationResponse, SearchProfile } from '@job-scout/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import type { Clock } from '../../src/ports/clock.js';
import { FakeEmbedder } from '../fakes/fakeEmbedder.js';
import { FakeLlm } from '../fakes/fakeLlm.js';
import { FakeBlobStore, FakeDocParser } from '../fakes/fakeStorage.js';
import { FakeVectorStore } from '../fakes/fakeVectorStore.js';

const repos = createRepos(createDb(env.DB));
const clock: Clock = { now: () => new Date('2026-11-20T09:00:00.000Z') };
const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;

const PDF_MIME = 'application/pdf';
const CV_TEXT =
  '# Jane Doe\nEnterprise Agile Coach with 12 years of experience leading SAFe transformations across banking and retail.';
const SUMMARY = {
  headline: 'Enterprise Agile Coach leading SAFe transformations',
  seniority: 'senior',
  yearsExperience: 12,
  skills: ['SAFe', 'Kanban', 'Coaching'],
  sectors: ['Banking', 'Retail'],
  suggestedTitles: ['Enterprise Agile Coach', 'SAFe Program Consultant', 'Agile Delivery Lead'],
  suggestedKeywords: ['SAFe', 'OKRs'],
};

const pdfBytes = (extra = 'body') => new TextEncoder().encode(`%PDF-1.7\n${extra}`);
const zipBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

function harness(opts: { llm?: FakeLlm; text?: string } = {}) {
  const fakes = {
    blobs: new FakeBlobStore(),
    docs: new FakeDocParser(opts.text ?? CV_TEXT),
    embedder: new FakeEmbedder(),
    vectors: new FakeVectorStore(),
    llm: opts.llm ?? FakeLlm.always(JSON.stringify(SUMMARY)),
  };
  const app = createApp((e) => createContainer(e, { clock, access: null, ...fakes }));
  const call = (path: string, init?: RequestInit) =>
    app.fetch(new Request(`http://localhost/api${path}`, init), devEnv);
  const json = (path: string, method: string, body?: unknown) =>
    call(path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    });
  const upload = (
    file: { bytes: Uint8Array; name?: string; type?: string } = { bytes: pdfBytes() },
    label?: string,
  ) => {
    const form = new FormData();
    form.set(
      'file',
      new File([file.bytes], file.name ?? 'Jane Doe CV.pdf', { type: file.type ?? PDF_MIME }),
    );
    if (label !== undefined) form.set('label', label);
    return call('/cvs', { method: 'POST', body: form });
  };
  return { fakes, call, json, upload };
}

const body = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeEach(async () => {
  for (const table of ['search_profiles', 'cvs', 'usage_daily', 'settings']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('POST /api/cvs', () => {
  it('stores the file, extracts text, summarises, embeds and pre-fills a profile', async () => {
    const h = harness();
    const res = await h.upload({ bytes: pdfBytes() }, 'Agile Coach');
    expect(res.status).toBe(201);

    const { cv, warnings } = await body<CvMutationResponse>(res);
    expect(warnings).toEqual([]);
    expect(cv).toMatchObject({
      label: 'Agile Coach',
      filename: 'Jane_Doe_CV.pdf',
      textMd: CV_TEXT,
      active: true,
      summary: SUMMARY,
    });
    expect(cv).not.toHaveProperty('r2Key');

    expect(cv.profile).toMatchObject({
      cvId: cv.id,
      jobTitles: SUMMARY.suggestedTitles,
      locations: ['London', 'Remote'],
      radiusMiles: 25,
      employmentTypes: ['contract', 'permanent'],
      ir35Preference: 'any',
      minDayRate: null,
      active: true,
    });

    expect([...h.fakes.blobs.objects.keys()]).toEqual([`cvs/${cv.id}/Jane_Doe_CV.pdf`]);
    expect(h.fakes.blobs.objects.get(`cvs/${cv.id}/Jane_Doe_CV.pdf`)?.mime).toBe(PDF_MIME);
    expect(h.fakes.docs.calls).toHaveLength(1);
    expect(h.fakes.vectors.items.get(`cv:${cv.id}`)?.metadata).toEqual({ kind: 'cv' });

    const usage = await repos.usage.get('2026-11-20');
    expect(usage).toMatchObject({ llmCalls: 1, embedCalls: 1 });
    expect(usage?.neuronsEst).toBeGreaterThan(0);
  });

  it('defaults the label to the file name and accepts a DOCX', async () => {
    const h = harness();
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const res = await h.upload({ bytes: zipBytes(), name: 'Delivery Lead.docx', type: docx });
    expect(res.status).toBe(201);
    expect((await body<CvMutationResponse>(res)).cv.label).toBe('Delivery Lead');
  });

  it('falls back to the label as the profile title when the summary fails', async () => {
    const h = harness({ llm: FakeLlm.always(new Error('model down')) });
    const { cv, warnings } = await body<CvMutationResponse>(
      await h.upload({ bytes: pdfBytes() }, 'Scrum Master'),
    );
    expect(cv.summary).toBeNull();
    expect(cv.profile?.jobTitles).toEqual(['Scrum Master']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Could not summarise');
    // The CV is still embedded and searchable.
    expect(h.fakes.vectors.items.has(`cv:${cv.id}`)).toBe(true);
  });

  it('keeps the CV and warns when embedding fails', async () => {
    const h = harness();
    h.fakes.embedder.failNext = new Error('embedding service down');
    const { cv, warnings } = await body<CvMutationResponse>(await h.upload());
    expect(cv.summary).toEqual(SUMMARY);
    expect(warnings).toEqual([
      expect.stringContaining('Could not embed this CV: embedding service down'),
    ]);
    expect(h.fakes.vectors.items.size).toBe(0);
  });

  it('keeps the CV with empty text when extraction fails, and skips the AI steps', async () => {
    const h = harness();
    h.fakes.docs.failWith = new Error('Could not read this document: encrypted');
    const { cv, warnings } = await body<CvMutationResponse>(await h.upload());
    expect(cv.textMd).toBe('');
    expect(warnings).toEqual([expect.stringContaining('encrypted')]);
    expect(h.fakes.llm.requests).toHaveLength(0);
    expect(h.fakes.vectors.items.size).toBe(0);
    expect(cv.profile).not.toBeNull();
  });

  it('warns once when the extracted text is too short to analyse', async () => {
    const h = harness({ text: 'tiny' });
    const { warnings } = await body<CvMutationResponse>(await h.upload());
    expect(warnings).toEqual([expect.stringContaining('No readable text')]);
    expect(h.fakes.llm.requests).toHaveLength(0);
  });

  it.each([
    ['a non-PDF/DOCX type', { bytes: pdfBytes(), type: 'text/plain' }, 'Only PDF and DOCX'],
    [
      'content that is not a document',
      { bytes: new TextEncoder().encode('MZ not a pdf') },
      'do not look like',
    ],
    ['a PDF type with DOCX contents', { bytes: zipBytes() }, 'do not look like'],
    ['an empty file', { bytes: new Uint8Array() }, 'empty'],
  ])('rejects %s', async (_label, file, message) => {
    const h = harness();
    const res = await h.upload(file);
    expect(res.status).toBe(400);
    const err = await body<{ error: { code: string; message: string } }>(res);
    expect(err.error.code).toBe('VALIDATION');
    expect(err.error.message).toContain(message);
    expect(h.fakes.blobs.objects.size).toBe(0);
    expect(await repos.cvs.list()).toEqual([]);
  });

  it('rejects a file over the configured size limit', async () => {
    await repos.settings.put('cvs', { maxUploadBytes: 64 }, '2026-11-20T00:00:00.000Z');
    const res = await harness().upload({ bytes: pdfBytes('x'.repeat(200)) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('larger than');
  });

  it('rejects a request with no file field', async () => {
    const h = harness();
    const form = new FormData();
    form.set('label', 'nothing attached');
    const res = await h.call('/cvs', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('refuses a fifth active CV with a clear 409, and inactive CVs do not count', async () => {
    const h = harness();
    const ids: string[] = [];
    for (let i = 1; i <= 4; i++) {
      ids.push(
        (await body<CvMutationResponse>(await h.upload({ bytes: pdfBytes(`cv${i}`) }, `CV ${i}`)))
          .cv.id,
      );
    }

    const fifth = await h.upload({ bytes: pdfBytes('cv5') }, 'CV 5');
    expect(fifth.status).toBe(409);
    expect(JSON.stringify(await fifth.json())).toContain('4 active CVs');
    expect(await repos.cvs.list()).toHaveLength(4);
    expect(h.fakes.blobs.objects.size).toBe(4);

    expect((await h.json(`/cvs/${ids[0]}`, 'PATCH', { active: false })).status).toBe(200);
    expect((await h.upload({ bytes: pdfBytes('cv5') }, 'CV 5')).status).toBe(201);

    // The slot is taken again, so re-activating the first CV must fail.
    const reactivate = await h.json(`/cvs/${ids[0]}`, 'PATCH', { active: true });
    expect(reactivate.status).toBe(409);
  });

  it('returns 503 NOT_CONFIGURED, creating nothing, when R2 is not set up', async () => {
    // The default container has no CVS binding in this environment.
    const app = createApp((e) =>
      createContainer(e, { clock, access: null, docs: new FakeDocParser(CV_TEXT) }),
    );
    const form = new FormData();
    form.set('file', new File([pdfBytes()], 'cv.pdf', { type: PDF_MIME }));
    const res = await app.fetch(
      new Request('http://localhost/api/cvs', { method: 'POST', body: form }),
      devEnv,
    );
    expect(res.status).toBe(503);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe('NOT_CONFIGURED');
    expect(await repos.cvs.list()).toEqual([]);
  });
});

describe('GET /api/cvs', () => {
  it('lists CVs without text or storage keys, and returns detail with text and profile', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(
      await h.upload({ bytes: pdfBytes() }, 'Agile Coach'),
    );

    const list = await body<CvListItem[]>(await h.call('/cvs'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: cv.id, label: 'Agile Coach', profileId: cv.profile?.id });
    expect(list[0]).not.toHaveProperty('textMd');
    expect(list[0]).not.toHaveProperty('r2Key');

    const detail = await body<CvDetail>(await h.call(`/cvs/${cv.id}`));
    expect(detail.textMd).toBe(CV_TEXT);
    expect(detail.profile?.id).toBe(cv.profile?.id);
    expect((await h.call('/cvs/nope')).status).toBe(404);
  });
});

describe('PATCH /api/cvs/:id', () => {
  it('renaming or toggling does not call the AI', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    const before = h.fakes.llm.requests.length;

    const res = await h.json(`/cvs/${cv.id}`, 'PATCH', { label: 'Renamed', active: false });
    const updated = await body<CvMutationResponse>(res);
    expect(updated.cv).toMatchObject({ label: 'Renamed', active: false });
    expect(updated.warnings).toEqual([]);
    expect(h.fakes.llm.requests).toHaveLength(before);
  });

  it('re-summarises and re-embeds only when the text actually changes', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    const firstVector = h.fakes.vectors.items.get(`cv:${cv.id}`)?.values;
    const calls = h.fakes.llm.requests.length;

    const same = await h.json(`/cvs/${cv.id}`, 'PATCH', { textMd: CV_TEXT });
    expect(same.status).toBe(200);
    expect(h.fakes.llm.requests).toHaveLength(calls);

    const newText =
      '# Jane Doe\nProgramme Manager with 15 years delivering large government technology programmes and PRINCE2 governance.';
    const changed = await h.json(`/cvs/${cv.id}`, 'PATCH', { textMd: newText });
    expect((await body<CvMutationResponse>(changed)).cv.textMd).toBe(newText);
    expect(h.fakes.llm.requests).toHaveLength(calls + 1);
    expect(h.fakes.vectors.items.get(`cv:${cv.id}`)?.values).not.toEqual(firstVector);
  });

  it('validates the body and 404s unknown ids', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    expect((await h.json(`/cvs/${cv.id}`, 'PATCH', { label: '' })).status).toBe(400);
    expect((await h.json('/cvs/missing', 'PATCH', { label: 'x' })).status).toBe(404);
  });
});

describe('POST /api/cvs/:id/analyse', () => {
  it('re-runs the summary and recreates a missing profile', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    await repos.profiles.deleteByCvId(cv.id);
    const calls = h.fakes.llm.requests.length;

    const res = await h.json(`/cvs/${cv.id}/analyse`, 'POST');
    const out = await body<CvMutationResponse>(res);
    expect(h.fakes.llm.requests).toHaveLength(calls + 1);
    expect(out.cv.profile?.jobTitles).toEqual(SUMMARY.suggestedTitles);
    expect((await h.json('/cvs/missing/analyse', 'POST')).status).toBe(404);
  });

  it('does not overwrite an existing, user-edited profile', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    const profile = cv.profile as SearchProfile;
    await repos.profiles.update(
      profile.id,
      { ...profile, jobTitles: ['My Custom Title'] },
      '2026-11-20T10:00:00.000Z',
    );

    const out = await body<CvMutationResponse>(await h.json(`/cvs/${cv.id}/analyse`, 'POST'));
    expect(out.cv.profile?.jobTitles).toEqual(['My Custom Title']);
  });
});

describe('DELETE /api/cvs/:id', () => {
  it('removes the row, profile, stored file and vector', async () => {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    expect(h.fakes.blobs.objects.size).toBe(1);

    const res = await h.call(`/cvs/${cv.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(h.fakes.blobs.objects.size).toBe(0);
    expect(h.fakes.vectors.items.size).toBe(0);
    expect(await repos.cvs.getById(cv.id)).toBeUndefined();
    expect(await repos.profiles.getByCvId(cv.id)).toBeUndefined();
    expect((await h.call(`/cvs/${cv.id}`)).status).toBe(404);
    expect((await h.call(`/cvs/${cv.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('/api/profiles', () => {
  async function withProfile() {
    const h = harness();
    const { cv } = await body<CvMutationResponse>(await h.upload());
    return { h, profile: cv.profile as SearchProfile };
  }

  it('lists and reads profiles', async () => {
    const { h, profile } = await withProfile();
    const list = await body<SearchProfile[]>(await h.call('/profiles'));
    expect(list.map((p) => p.id)).toEqual([profile.id]);
    expect((await body<SearchProfile>(await h.call(`/profiles/${profile.id}`))).cvId).toBe(
      profile.cvId,
    );
    expect((await h.call('/profiles/nope')).status).toBe(404);
  });

  it('updates a profile and returns it', async () => {
    const { h, profile } = await withProfile();
    const res = await h.json(`/profiles/${profile.id}`, 'PUT', {
      jobTitles: ['Agile Coach', 'Delivery Lead'],
      mustKeywords: ['SAFe'],
      excludeKeywords: ['graduate', 'junior'],
      locations: ['London'],
      radiusMiles: 15,
      employmentTypes: ['contract'],
      minDayRate: 550,
      ir35Preference: 'outside_only',
      workModes: ['remote', 'hybrid'],
      maxOnsiteDays: 2,
      active: false,
    });
    expect(res.status).toBe(200);
    expect(await body<SearchProfile>(res)).toMatchObject({
      id: profile.id,
      cvId: profile.cvId,
      jobTitles: ['Agile Coach', 'Delivery Lead'],
      minDayRate: 550,
      minSalary: null,
      ir35Preference: 'outside_only',
      workModes: ['remote', 'hybrid'],
      maxOnsiteDays: 2,
      active: false,
    });
    expect(await repos.profiles.listActive()).toEqual([]);
  });

  it('rejects an invalid profile and 404s an unknown id', async () => {
    const { h, profile } = await withProfile();
    const bad = await h.json(`/profiles/${profile.id}`, 'PUT', {
      jobTitles: [],
      locations: ['London'],
      employmentTypes: ['contract'],
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toContain('jobTitles');

    const missing = await h.json('/profiles/nope', 'PUT', {
      jobTitles: ['x'],
      locations: ['London'],
      employmentTypes: ['contract'],
    });
    expect(missing.status).toBe(404);
  });
});
