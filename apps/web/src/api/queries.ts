import {
  CvDetailSchema,
  CvListResponseSchema,
  CvMutationResponseSchema,
  GroupListResponseSchema,
  RunDetailSchema,
  RunListResponseSchema,
  SearchProfileSchema,
  type Settings,
  SettingsSchema,
  StartRunResponseSchema,
  type UpdateCvRequest,
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

export const useGroups = (show: 'shortlist' | 'filtered') =>
  useQuery({
    queryKey: ['groups', show] as const,
    queryFn: () => api(`/groups?show=${show}&limit=100`, GroupListResponseSchema),
  });
