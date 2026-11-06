import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useWorkspaces, WorkspaceContext } from './workspace-state';

const STORAGE_KEY = 'ogs.workspace';

/**
 * Remembers the chosen workspace in this browser only. A stale choice (the
 * membership ended) falls back to the personal workspace.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useWorkspaces();
  const [stored, setStored] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? 'personal',
  );

  const workspaces = useMemo(() => data ?? [], [data]);
  const current = workspaces.find((workspace) => workspace.tenantId === stored);
  // Keep the stored choice while the list loads (switching to personal and back
  // would remount every page). Fall back to personal only once the list proves
  // the stored workspace is gone.
  const selected = isLoading || current !== undefined ? stored : 'personal';

  const select = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setStored(id);
  }, []);

  const value = useMemo(
    () => ({ selected, current, workspaces, isLoading, error, select }),
    [selected, current, workspaces, isLoading, error, select],
  );
  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}
