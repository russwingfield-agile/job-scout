import {
  ApiErrorResponseSchema,
  type CvMutationResponse,
  CvMutationResponseSchema,
} from '@job-scout/shared';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Turn an error response into an ApiError, using the server's JSON envelope when present. */
export async function toApiError(res: Response): Promise<ApiError> {
  try {
    const parsed = ApiErrorResponseSchema.safeParse(await res.json());
    if (parsed.success) {
      const { code, message, issues } = parsed.data.error;
      return new ApiError(res.status, code, message, issues ?? []);
    }
  } catch {
    // body was not JSON (e.g. an Access sign-in page); fall through
  }
  return new ApiError(res.status, 'INTERNAL', `Request failed (HTTP ${res.status})`);
}

/** Same-origin JSON request, validated against a shared schema. 204 responses resolve to undefined. */
export async function api<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
  const hasJsonBody = typeof init.body === 'string';
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

/** Upload a CV with progress (fetch cannot report upload progress, XHR can). */
export function uploadCv(
  file: File,
  label: string | undefined,
  onProgress: (percent: number) => void,
): Promise<CvMutationResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set('file', file);
    if (label) form.set('label', label);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/cvs');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Network error while uploading.'));
    xhr.onload = () => {
      const response = new Response(xhr.responseText, { status: xhr.status });
      if (xhr.status < 200 || xhr.status >= 300) {
        void toApiError(response).then(reject);
        return;
      }
      response
        .json()
        .then((json) => resolve(CvMutationResponseSchema.parse(json)))
        .catch(reject);
    };
    xhr.send(form);
  });
}
