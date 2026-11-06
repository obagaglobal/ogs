import type {
  PublicCategoryResponse,
  PublicCategoryTreeResponse,
  PublicServiceDetail,
  PublicServiceListResponse,
} from '@ogs/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CatalogueFilters {
  readonly q?: string;
  readonly category?: string;
  readonly model?: string;
  readonly audience?: string;
  readonly delivery?: string;
}

export const AUDIENCE_LABELS: Record<string, string> = {
  ALL: 'Everyone',
  ORGANISATIONS: 'Organisations',
  INDIVIDUALS: 'Individuals',
};
export const DELIVERY_LABELS: Record<string, string> = {
  ON_SITE: 'On site',
  REMOTE: 'Remote',
  BOTH: 'On site or remote',
};
export const MODEL_LABELS: Record<string, string> = {
  FIXED: 'Fixed price',
  PER_UNIT: 'Priced per unit',
  FROM: 'Starting price',
  QUOTE: 'On quotation',
};

/** Only the filters that are set, in a stable order (query key and URL). */
export function filterParams(filters: CatalogueFilters): Record<string, string> {
  const entries = (['q', 'category', 'model', 'audience', 'delivery'] as const)
    .map((key) => [key, filters[key]?.trim() ?? ''] as const)
    .filter(([, value]) => value !== '');
  return Object.fromEntries(entries);
}

export function useCategoryTree() {
  return useQuery({
    queryKey: ['catalogue', 'categories'],
    queryFn: async () =>
      (await api<PublicCategoryTreeResponse>('/catalogue/categories')).categories,
    staleTime: 60_000,
  });
}

export function usePublicCategory(slug: string) {
  return useQuery({
    queryKey: ['catalogue', 'category', slug],
    queryFn: async () => api<PublicCategoryResponse>(`/catalogue/categories/${slug}`),
    retry: false,
  });
}

/** Search with keyset pages ("Load more"); the cursor always comes from the server. */
export function useServiceSearch(filters: CatalogueFilters) {
  const params = filterParams(filters);
  return useInfiniteQuery({
    queryKey: ['catalogue', 'services', params],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams(params);
      if (pageParam !== null) query.set('cursor', pageParam);
      return api<PublicServiceListResponse>(`/catalogue/services?${query.toString()}`);
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 60_000,
  });
}

export function usePublicService(slug: string) {
  return useQuery({
    queryKey: ['catalogue', 'service', slug],
    queryFn: async () => api<PublicServiceDetail>(`/catalogue/services/${slug}`),
    retry: false,
  });
}

/**
 * "3,500.50" → 350050. Parsed as text (never through a float), so staff input
 * always becomes exact minor units. Returns null when it is not an amount.
 */
export function parseKesToMinor(input: string): number | null {
  const text = input
    .trim()
    .replace(/,/g, '')
    .replace(/^KES\s*/i, '');
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) {
    return null;
  }
  const shillings = Number(match[1]);
  const cents = Number((match[2] ?? '0').padEnd(2, '0'));
  return shillings * 100 + cents;
}

/** Minor units → the text staff edit ("3500.50", "3500"). */
export function minorToInput(minor: number | null): string {
  if (minor === null) {
    return '';
  }
  const cents = minor % 100;
  return cents === 0
    ? String(Math.floor(minor / 100))
    : `${String(Math.floor(minor / 100))}.${String(cents).padStart(2, '0')}`;
}
