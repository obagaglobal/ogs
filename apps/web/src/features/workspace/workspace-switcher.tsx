import { useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useWorkspace } from './workspace-state';

const KIND_LABEL = {
  ORGANISATION: 'Organisation',
  PROVIDER_COMPANY: 'Provider company',
  PLATFORM: 'OGS platform',
} as const;

/**
 * Header control that always shows the workspace the user is acting in
 * (review §7: "context must be explicit") and lets them switch.
 */
export function WorkspaceSwitcher() {
  const { selected, workspaces, select } = useWorkspace();
  const queryClient = useQueryClient();
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Workspace
      </label>
      <select
        id={id}
        value={selected}
        onChange={(event) => {
          select(event.target.value);
          void queryClient.invalidateQueries({ queryKey: ['workspace'] });
        }}
        className="h-9 max-w-64 rounded-md border bg-background px-2 text-sm"
      >
        <option value="personal">Personal</option>
        {workspaces.map((workspace) => (
          <option key={workspace.tenantId} value={workspace.tenantId}>
            {workspace.name} · {KIND_LABEL[workspace.kind]}
            {workspace.restricted ? ' (pending)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
