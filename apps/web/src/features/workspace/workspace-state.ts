import type {
  CurrentWorkspaceResponse,
  WorkspaceListResponse,
  WorkspaceSummary,
} from '@ogs/contracts';
import { useQuery } from '@tanstack/react-query';
import { createContext, use } from 'react';
import { api } from '@/lib/api';

/** The person's individual-provider capacity (Phase 5), when they have one. */
export type ProviderCapacity = NonNullable<WorkspaceListResponse['provider']>;

/** Workspace value for the individual-provider capacity (X-OGS-Workspace: provider). */
export { PROVIDER_WORKSPACE } from '@ogs/contracts';

export interface WorkspaceState {
  /**
   * `personal`, `provider` or a tenant id. Sent as X-OGS-Workspace; the server
   * decides what it grants.
   */
  readonly selected: string;
  readonly current: WorkspaceSummary | undefined;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly provider: ProviderCapacity | null;
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly select: (id: string) => void;
}

export const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function useWorkspaces() {
  return useQuery({
    queryKey: ['me', 'workspaces'],
    queryFn: async () => api<WorkspaceListResponse>('/me/workspaces'),
    retry: false,
  });
}

export function useWorkspace(): WorkspaceState {
  const state = use(WorkspaceContext);
  if (state === undefined) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  }
  return state;
}

/** The selected workspace as the server grants it (kind, roles, permissions). */
export function useCurrentWorkspace() {
  const { selected } = useWorkspace();
  return useQuery({
    queryKey: ['workspace', selected],
    queryFn: async () => api<CurrentWorkspaceResponse>('/workspace', { workspace: selected }),
    retry: false,
  });
}

export function useCan(permission: string): boolean {
  const { data } = useCurrentWorkspace();
  return data !== undefined && 'permissions' in data && data.permissions.includes(permission);
}
