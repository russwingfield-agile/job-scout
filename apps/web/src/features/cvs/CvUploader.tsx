import type { CvMutationResponse } from '@job-scout/shared';
import { type DragEvent, useRef, useState } from 'react';
import { ApiError, uploadCv } from '../../api/client.js';
import { useToast } from '../../components/ui/Toast.js';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ACCEPTED_EXTENSIONS = /\.(pdf|docx)$/i;

/** Quick client-side check so obvious mistakes fail before an upload; the server re-validates. */
export function validateCvFile(file: File, maxBytes: number): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes) {
    return `That file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  }
  const typeOk = ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.test(file.name);
  return typeOk ? null : 'Only PDF and DOCX files are supported.';
}

export type CvUploaderProps = {
  maxBytes: number;
  onUploaded: (result: CvMutationResponse) => void;
};

/** Drag-and-drop (or click) upload with a progress bar. */
export function CvUploader({ maxBytes, onUploaded }: CvUploaderProps) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = progress !== null;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    const problem = validateCvFile(file, maxBytes);
    if (problem) {
      toast.push('error', problem);
      return;
    }
    setProgress(0);
    try {
      const result = await uploadCv(file, undefined, setProgress);
      toast.push('success', `Added "${result.cv.label}".`);
      for (const warning of result.warnings) toast.push('warning', warning);
      onUploaded(result);
    } catch (err) {
      toast.push('error', err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload(e.dataTransfer.files[0]);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is an enhancement; the "Choose file" button and hidden file input below are the accessible, keyboard-operable path.
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-sm ${
        dragging ? 'border-[var(--accent)] bg-[var(--surface-2)]' : 'border-[var(--border)]'
      }`}
    >
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        aria-label="Choose a CV file"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {busy ? (
        <>
          <p>Uploading and analysing… {progress}%</p>
          <progress value={progress} max={100} aria-label="Upload progress" className="w-full" />
          {progress === 100 ? (
            <p className="text-xs text-[var(--muted)]">
              Reading your CV — this can take a few seconds.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p>Drop a PDF or DOCX here</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-medium"
          >
            Choose file
          </button>
        </>
      )}
    </div>
  );
}
