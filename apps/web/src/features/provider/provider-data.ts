import type { ProviderResponse, RegionListResponse, SkillListResponse } from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCan, useWorkspace, PROVIDER_WORKSPACE } from '@/features/workspace/workspace-state';
import { api, type RequestOptions } from '@/lib/api';

export type ExperienceBand = ProviderResponse['skills'][number]['experience'];
export interface SkillChoice {
  readonly code: string;
  readonly experience: ExperienceBand;
}
export interface HoursEntry {
  readonly weekday: number;
  readonly start: string;
  readonly end: string;
}

export const EXPERIENCE_LABELS: Record<ExperienceBand, string> = {
  UNDER_1_YEAR: 'Under 1 year',
  YEARS_1_3: '1–3 years',
  YEARS_3_5: '3–5 years',
  OVER_5_YEARS: 'Over 5 years',
};

/** ISO weekday (1 = Monday … 7 = Sunday), as the API stores working hours. */
export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** Working hours and time off are local to Kenya (Phase 5 plan §2.3); no daylight saving. */
export const PROVIDER_TIME_ZONE = 'Africa/Nairobi';
const NAIROBI_OFFSET = '+03:00';

/** `<input type="datetime-local">` value, read as Nairobi time → ISO 8601 with offset. */
export function nairobiInputToIso(value: string): string {
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}${NAIROBI_OFFSET}`;
}

export function formatNairobi(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', {
    timeZone: PROVIDER_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ['reference', 'skills'],
    queryFn: async () => (await api<SkillListResponse>('/reference/skills')).skills,
    staleTime: 5 * 60_000,
  });
}

export function useRegions() {
  return useQuery({
    queryKey: ['reference', 'regions'],
    queryFn: async () => (await api<RegionListResponse>('/reference/regions')).regions,
    staleTime: 60 * 60_000,
  });
}

/** The provider this workspace acts as (individual or company), and whether it may edit. */
export function useProvider() {
  const { selected } = useWorkspace();
  const canManage = useCan('provider.profile.manage');
  const query = useQuery({
    queryKey: ['provider', selected],
    queryFn: async () => api<ProviderResponse>('/provider', { workspace: selected }),
    retry: false,
    enabled: selected !== 'personal',
  });
  const data = query.data;
  const mayManage = selected === PROVIDER_WORKSPACE || canManage;
  const frozen =
    data === undefined ||
    data.status === 'SUSPENDED' ||
    data.status === 'REJECTED' ||
    data.application.status === 'SUBMITTED';
  return { ...query, selected, mayManage, editable: mayManage && !frozen };
}

/** A write to /provider/*; refreshes the provider and the workspace list on success. */
export function useProviderWrite<V>(
  request: (value: V) => {
    path: string;
    method: NonNullable<RequestOptions['method']>;
    body?: unknown;
  },
) {
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: V) => {
      const { path, method, body } = request(value);
      return api<ProviderResponse>(path, { method, body, workspace: selected });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['provider'] });
      await queryClient.invalidateQueries({ queryKey: ['me', 'workspaces'] });
    },
  });
}

/** True when every entry is a valid range (the API refuses the rest). */
export function hoursValid(hours: readonly HoursEntry[]): boolean {
  return hours.every((entry) => entry.start !== '' && entry.end !== '' && entry.start < entry.end);
}
