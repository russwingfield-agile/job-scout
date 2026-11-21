import {
  ClearJobsResponseSchema,
  CoverNoteListSchema,
  type CoverNoteRequest,
  CoverNoteSchema,
  CvDetailSchema,
  CvListResponseSchema,
  CvMutationResponseSchema,
  DeleteAllDataResponseSchema,
  GroupDetailSchema,
  type GroupListItem,
  GroupListResponseSchema,
  type GroupStatus,
  RescoreResponseSchema,
  RunDetailSchema,
  RunListResponseSchema,
  SearchProfileSchema,
  type Settings,
  type SettingsPatch,
  SettingsSchema,
  StartRunResponseSchema,
  StatsResponseSchema,
  SuggestionListSchema,
  type UpdateCvRequest,
  type UpdateGroupRequest,
  type UpdateSearchProfile,
} from '@job-scout/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client.js';

export const keys = {
  cvs: ['cvs'] as const,
  cv: (id: string) => ['cv', id] as const,
  settings: ['settings'] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
};

/** Only the part of Settings the CV screens need; the server returns more and zod ignores it. */
export const useSettings = () =>
  useQuery<Pick<Settings, 'cvs'>>({
    queryKey: keys.settings,
    queryFn: () => api('/settings', SettingsSchema.pick({ cvs: true })),
  });

export const useCvs = () =>
  useQuery({ queryKey: keys.cvs, queryFn: () => api('/cvs', CvListResponseSchema) });

export const useCv = (id: string | null) =>
  useQuery({
    queryKey: keys.cv(id ?? ''),
    queryFn: () => api(`/cvs/${id}`, CvDetailSchema),
    enabled: id !== null,
  });

/** Refresh the list and the one CV that changed. */
export function useInvalidateCv() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: keys.cvs });
    if (id) void qc.invalidateQueries({ queryKey: keys.cv(id) });
  };
}

export function useUpdateCv(id: string) {
  const invalidate = useInvalidateCv();
  return useMutation({
    mutationFn: (patch: UpdateCvRequest) =>
      api(`/cvs/${id}`, CvMutationResponseSchema, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => invalidate(id),
  });
}

export function useReanalyseCv(id: string) {
  const invalidate = useInvalidateCv();
  return useMutation({
    mutationFn: () => api(`/cvs/${id}/analyse`, CvMutationResponseSchema, { method: 'POST' }),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteCv() {
  const invalidate = useInvalidateCv();
  return useMutation({
    mutationFn: (id: string) => api(`/cvs/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useUpdateProfile(profileId: string, cvId: string) {
  const invalidate = useInvalidateCv();
  return useMutation({
    mutationFn: (profile: UpdateSearchProfile) =>
      api(`/profiles/${profileId}`, SearchProfileSchema, {
        method: 'PUT',
        body: JSON.stringify(profile),
      }),
    onSuccess: () => invalidate(cvId),
  });
}

/** Poll while anything is running so the page shows live progress, then stop. */
const RUN_POLL_MS = 3_000;

export const useRuns = () =>
  useQuery({
    queryKey: keys.runs,
    queryFn: () => api('/runs', RunListResponseSchema),
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === 'running') ? RUN_POLL_MS : false,
  });

export const useRun = (id: string | null) =>
  useQuery({
    queryKey: keys.run(id ?? ''),
    queryFn: () => api(`/runs/${id}`, RunDetailSchema),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? RUN_POLL_MS : false),
  });

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/runs', StartRunResponseSchema, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.runs }),
  });
}

/** Forget every job you have not acted on, so the next run finds them again from scratch. */
export function useClearJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/groups/clear', ClearJobsResponseSchema, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export type GroupView = 'shortlist' | 'more' | 'filtered' | 'pipeline';

export type GroupFilterParams = {
  show: GroupView;
  type?: 'contract' | 'permanent' | undefined;
  cvId?: string | undefined;
  minScore?: number | undefined;
  workMode?: 'remote' | 'hybrid' | 'onsite' | undefined;
  ir35?: 'inside' | 'outside' | undefined;
  postedWithinDays?: number | undefined;
};

const queryString = (p: GroupFilterParams): string => {
  const q = new URLSearchParams({ show: p.show, limit: '100' });
  if (p.type) q.set('type', p.type);
  if (p.cvId) q.set('cvId', p.cvId);
  if (p.minScore) q.set('minScore', String(p.minScore));
  if (p.workMode) q.set('workMode', p.workMode);
  if (p.ir35) q.set('ir35', p.ir35);
  if (p.postedWithinDays) q.set('postedWithinDays', String(p.postedWithinDays));
  return q.toString();
};

export const useGroups = (params: GroupFilterParams) =>
  useQuery({
    queryKey: ['groups', params] as const,
    queryFn: () => api(`/groups?${queryString(params)}`, GroupListResponseSchema),
  });

export const useGroup = (id: string | null) =>
  useQuery({
    queryKey: ['group', id] as const,
    queryFn: () => api(`/groups/${id}`, GroupDetailSchema),
    enabled: id !== null,
  });

export const useStats = () =>
  useQuery({
    queryKey: ['stats'] as const,
    queryFn: () => api('/stats', StatsResponseSchema),
    refetchInterval: 60_000,
  });

/** Score badge thresholds (Strong / Good / Maybe) from Settings. */
export const useThresholds = () =>
  useQuery({
    queryKey: ['settings', 'thresholds'] as const,
    queryFn: () => api('/settings', SettingsSchema.pick({ thresholds: true })),
    select: (s) => s.thresholds,
  });

type GroupsCache = [readonly unknown[], { items: GroupListItem[]; total: number } | undefined][];

/**
 * Act on a job. The card leaves its list immediately (optimistic); if the server refuses, the list
 * is put back and the error is shown. Everything is refetched afterwards so the page tells the truth.
 */
export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: UpdateGroupRequest }) =>
      api(`/groups/${id}`, z.object({ status: z.string() }), {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['groups'] });
      const snapshot: GroupsCache = qc.getQueriesData({ queryKey: ['groups'] });
      for (const [key, data] of snapshot) {
        if (!data) continue;
        qc.setQueryData(key, {
          items: data.items.filter((i) => i.id !== id),
          total: Math.max(0, data.total - (data.items.some((i) => i.id === id) ? 1 : 0)),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['groups'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      void qc.invalidateQueries({ queryKey: ['group', vars.id] });
    },
  });
}

export function useSaveNotes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) =>
      api(`/groups/${id}/notes`, z.object({ ok: z.boolean() }), {
        method: 'PUT',
        body: JSON.stringify({ notes }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group', id] }),
  });
}

export function useRescore(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/groups/${id}/rescore`, RescoreResponseSchema, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['group', id] });
      void qc.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}

export type { GroupStatus };

export const useCoverNotes = (groupId: string) =>
  useQuery({
    queryKey: ['coverNotes', groupId] as const,
    queryFn: () => api(`/groups/${groupId}/cover-notes`, CoverNoteListSchema),
  });

export function useGenerateCoverNote(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CoverNoteRequest) =>
      api(`/groups/${groupId}/cover-note`, CoverNoteSchema, {
        method: 'POST',
        body: JSON.stringify(req),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['coverNotes', groupId] }),
  });
}

export const useSuggestions = () =>
  useQuery({
    queryKey: ['suggestions'] as const,
    queryFn: () => api('/suggestions', SuggestionListSchema),
  });

/** Apply or dismiss a suggestion. Applying changes a search profile, so CVs are refreshed too. */
export function useSuggestionAction(action: 'apply' | 'dismiss') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/suggestions/${action}`, z.object({}).passthrough(), {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      if (action === 'apply') void qc.invalidateQueries({ queryKey: keys.cvs });
    },
  });
}

/** The whole Settings object (the Settings page edits several sections of it). */
export const useAllSettings = () =>
  useQuery({
    queryKey: ['settings', 'all'] as const,
    queryFn: () => api('/settings', SettingsSchema),
  });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      api('/settings', SettingsSchema, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useDeleteAllData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) =>
      api('/data', DeleteAllDataResponseSchema, {
        method: 'DELETE',
        body: JSON.stringify({ confirm }),
      }),
    onSuccess: () => void qc.invalidateQueries(),
  });
}
