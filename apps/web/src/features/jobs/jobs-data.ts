import type {
  AssigneeJob,
  AssigneeJobList,
  AssigneeOffer,
  CustomerJobProgress,
  JobCandidates,
  JobStatus,
  StaffJob,
  StaffJobQueue,
  StaffJobSummary,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Status } from '@/components/ui/badge';
import { useElevated } from '@/features/platform/elevation-state';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { t, type MessageKey } from '@/i18n';
import { idempotent } from '@/features/requests/requests-data';
import { ApiError, api, uploadFile, type RequestOptions } from '@/lib/api';

export { idempotent, useIdempotencyKey } from '@/features/requests/requests-data';

/**
 * Data for jobs (Phase 9). Three audiences, three sets of hooks: assignees
 * (/jobs), staff (/platform/jobs, elevated) and customers (the tracker on
 * request and ticket pages). Every write refreshes the job it touched.
 */

// ---------------------------------------------------------------- labels

export function jobStatusLabel(status: JobStatus): string {
  return t(`jobs.status.${status}` as MessageKey);
}

/** The shared status vocabulary: "live" (saffron) only while someone is at work. */
export function jobPill(status: JobStatus): Status {
  switch (status) {
    case 'QUEUED':
    case 'OFFERED':
      return 'pending';
    case 'ASSIGNED':
    case 'ON_THE_WAY':
    case 'IN_PROGRESS':
      return 'live';
    case 'PAUSED':
    case 'AWAITING_CONFIRMATION':
      return 'pending';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'suspended';
  }
}

export function jobEventLabel(kind: string, audience: 'staff' | 'customer' = 'staff'): string {
  const key = (
    audience === 'customer' ? `tracker.event.${kind}` : `jobs.event.${kind}`
  ) as MessageKey;
  const text = t(key);
  return text === key ? kind.replace(/_/g, ' ') : text;
}

/** "1 h 42 min", "12 min": time left on an offer. */
export function timeLeft(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) {
    return null;
  }
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** Re-renders every `ms` (offer countdowns). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, ms);
    return () => {
      window.clearInterval(timer);
    };
  }, [ms]);
  return now;
}

const dayFormat = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
export function formatDay(day: string | null): string {
  return day === null ? '' : dayFormat.format(new Date(`${day}T00:00:00`));
}

/** The job is no longer the caller's: reassigned, removed, cancelled or completed. */
export function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// ---------------------------------------------------------------- drafts (slow connections)

/**
 * Typed text survives a reload on a bad connection (plan §2.9): kept in
 * sessionStorage until it is sent. This is not offline mode (Phase 12).
 */
export function useDraft(key: string): [string, (value: string) => void, () => void] {
  const storageKey = `ogs.draft.${key}`;
  const [value, setValue] = useState(() => sessionStorage.getItem(storageKey) ?? '');
  return [
    value,
    (next: string) => {
      setValue(next);
      if (next === '') {
        sessionStorage.removeItem(storageKey);
      } else {
        sessionStorage.setItem(storageKey, next);
      }
    },
    () => {
      setValue('');
      sessionStorage.removeItem(storageKey);
    },
  ];
}

// ---------------------------------------------------------------- photos

/** Longest side of a photo after shrinking, and its JPEG quality (plan §2.9). */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.8;

/** The size a photo is drawn at: the longest side at most `max`, never enlarged. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Shrinks a photo on the phone before upload: re-encoded as JPEG at most
 * 1600 px, typically 200–400 KB. Re-encoding drops EXIF data, including the
 * GPS location (ADR-018). Falls back to the original if the browser cannot
 * decode it.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function' || !file.type.startsWith('image/')) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY);
    });
    if (blob === null) {
      return file;
    }
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------- assignees

function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['jobs'] }),
    queryClient.invalidateQueries({ queryKey: ['job'] }),
    queryClient.invalidateQueries({ queryKey: ['platform', 'jobs'] }),
    queryClient.invalidateQueries({ queryKey: ['platform', 'job'] }),
    queryClient.invalidateQueries({ queryKey: ['job-progress'] }),
  ]);
}

export function useAssigneeJobs(view: 'offers' | 'active' | 'done') {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['jobs', selected, view],
    queryFn: async () => api<AssigneeJobList>(`/jobs?view=${view}`, { workspace: selected }),
    retry: false,
  });
}

export function useOffer(offerId: string) {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['job', 'offer', selected, offerId],
    queryFn: async () => api<AssigneeOffer>(`/jobs/offers/${offerId}`, { workspace: selected }),
    retry: false,
  });
}

/** Technician screens refetch on focus and after each command; no polling (plan §2.9). */
export function useAssigneeJob(id: string) {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['job', selected, id],
    queryFn: async () => api<AssigneeJob>(`/jobs/${id}`, { workspace: selected }),
    retry: false,
  });
}

/** A command that returns the job (or anything): POST with the workspace, then refresh. */
export function useJobWrite<V, R = AssigneeJob>(
  request: (value: V) => { path: string; body?: unknown; options?: RequestOptions },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, body, options } = request(value);
      return api<R>(path, { method: 'POST', body, ...options });
    },
    onSuccess: async () => {
      await refresh(queryClient);
    },
  });
}

export function usePhotoUpload(jobId: string) {
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  /** `key`: the photo's Idempotency-Key, the SAME on every retry of that photo. */
  return async (file: File, caption: string, key: string): Promise<AssigneeJob> => {
    const photo = await shrinkPhoto(file);
    const form = new FormData();
    form.set('caption', caption);
    form.set('file', photo);
    const job = await uploadFile<AssigneeJob>(form, selected, {
      path: `/jobs/${jobId}/photos`,
      headers: idempotent(key),
    });
    await refresh(queryClient);
    return job;
  };
}

// ---------------------------------------------------------------- staff

export interface DispatchFilters {
  status: string;
  source: string;
}

export function useDispatchQueue(filters: DispatchFilters, page: number) {
  const { options, elevation } = useElevated();
  const params = new URLSearchParams({ page: String(page) });
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.source !== '') params.set('source', filters.source);
  return useQuery({
    queryKey: ['platform', 'jobs', params.toString()],
    queryFn: async () => api<StaffJobQueue>(`/platform/jobs?${params.toString()}`, options),
    enabled: elevation !== undefined,
    retry: false,
  });
}

export function useStaffJob(id: string) {
  const { options, elevation } = useElevated();
  return useQuery({
    queryKey: ['platform', 'job', id],
    queryFn: async () => api<StaffJob>(`/platform/jobs/${id}`, options),
    enabled: elevation !== undefined,
    retry: false,
  });
}

export function useCandidates(id: string, enabled: boolean) {
  const { options, elevation } = useElevated();
  return useQuery({
    queryKey: ['platform', 'job', id, 'candidates'],
    queryFn: async () => api<JobCandidates>(`/platform/jobs/${id}/candidates`, options),
    enabled: elevation !== undefined && enabled,
    retry: false,
  });
}

/** The job of an order or a ticket, for the staff order and ticket pages. */
export function useSourceJob(kind: 'orders' | 'tickets', id: string | undefined) {
  const { options, elevation } = useElevated();
  return useQuery({
    queryKey: ['platform', 'job', 'source', kind, id],
    queryFn: async () =>
      (await api<{ job: StaffJobSummary | null }>(`/platform/${kind}/${id ?? ''}/job`, options))
        .job,
    enabled: elevation !== undefined && id !== undefined,
    retry: false,
  });
}

export function useStaffJobWrite<V>(
  request: (value: V) => { path: string; body?: unknown; method?: 'POST' | 'PATCH' },
) {
  const { options } = useElevated();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, body, method } = request(value);
      return api<StaffJob>(path, { method: method ?? 'POST', body, ...options });
    },
    onSuccess: async () => {
      await refresh(queryClient);
    },
  });
}

// ---------------------------------------------------------------- customers

/**
 * The live tracker (plan §2.9): refetches every 30 s while the tab is visible
 * and the job is active; stops when it is completed or cancelled.
 */
export function useJobProgress(source: 'requests' | 'tickets', id: string) {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['job-progress', selected, source, id],
    queryFn: async () =>
      api<CustomerJobProgress>(`/${source}/${id}/progress`, { workspace: selected }),
    retry: false,
    // Orders: mounted only once the order is ready, so "no job yet" keeps polling
    // (the worker opens it within seconds). Tickets: only a ticket with a job polls.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.job === null) {
        return source === 'requests' ? 30_000 : false;
      }
      const status = data?.job?.status;
      return status === 'COMPLETED' || status === 'CANCELLED' ? false : 30_000;
    },
    refetchIntervalInBackground: false,
  });
}
