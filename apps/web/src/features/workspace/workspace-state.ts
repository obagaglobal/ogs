import type {
  CurrentWorkspaceResponse,
  WorkspaceListResponse,
  WorkspaceSummary,
} from '@ogs/contracts';
import { useQuery } from '@tanstack/react-query';
import { createContext, use } from 'react';
import { api } from '@/lib/api';

export interface WorkspaceState {
  /** `personal` or a tenant id. Sent as X-OGS-Workspace; the server decides what it grants. */
  readonly selected: string;
  readonly current: WorkspaceSummary | undefined;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly select: (id: string) => void;
}

export const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function useWorkspaces() {
  return useQuery({
    queryKey: ['me', 'workspaces'],
    queryFn: async () => (await api<WorkspaceListResponse>('/me/workspaces')).workspaces,
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
  return data !== undefined && data.kind !== 'personal' && data.permissions.includes(permission);
}
