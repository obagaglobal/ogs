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
  const selected = current === undefined ? 'personal' : stored;

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
