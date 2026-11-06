import type { CurrentSessionResponse } from '@ogs/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, resetCsrfToken } from '@/lib/api';

export const SESSION_QUERY_KEY = ['session'] as const;

/** The signed-in session, or null when signed out. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<CurrentSessionResponse | null> => {
      try {
        return await api<CurrentSessionResponse>('/auth/session');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

/** After sign-in, MFA, sign-out: new cookie → new CSRF token, and every cached answer is stale. */
export function useSessionChanged() {
  const queryClient = useQueryClient();
  return async () => {
    resetCsrfToken();
    await queryClient.invalidateQueries();
  };
}
