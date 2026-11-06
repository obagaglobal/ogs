import { useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { t, type MessageKey } from '@/i18n';
import { PROVIDER_WORKSPACE, useWorkspace } from './workspace-state';

const KIND_KEY = {
  ORGANISATION: 'workspace.kind.organisation',
  PROVIDER_COMPANY: 'workspace.kind.providerCompany',
  PLATFORM: 'workspace.kind.platform',
} as const satisfies Record<string, MessageKey>;

/**
 * Top-bar control that always shows the workspace the user is acting in
 * (review §7: "context must be explicit"): its name and its type (Personal,
 * Organisation, Provider, Provider company, OGS Platform). A native select on
 * purpose: keyboard and screen-reader behaviour for free, and phones show
 * their own picker.
 */
export function WorkspaceSwitcher() {
  const { selected, workspaces, provider, select } = useWorkspace();
  const queryClient = useQueryClient();
  const id = useId();

  const current = workspaces.find((workspace) => workspace.tenantId === selected);
  const kindLabel =
    selected === 'personal'
      ? t('workspace.kind.personal')
      : selected === PROVIDER_WORKSPACE
        ? t('workspace.kind.provider')
        : current
          ? t(KIND_KEY[current.kind])
          : null;
  const restricted =
    selected === PROVIDER_WORKSPACE
      ? (provider?.restricted ?? false)
      : (current?.restricted ?? false);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {t('workspace.label')}
      </label>
      <Select
        id={id}
        value={selected}
        onChange={(event) => {
          select(event.target.value);
          void queryClient.invalidateQueries({ queryKey: ['workspace'] });
        }}
        className="w-auto max-w-[11rem] font-display font-medium sm:max-w-64"
      >
        <option value="personal">{t('workspace.kind.personal')}</option>
        {provider === null ? null : (
          <option value={PROVIDER_WORKSPACE}>
            {t('workspace.kind.provider')} · Individual
            {provider.restricted
              ? ` (${provider.status === 'SUSPENDED' ? t('workspace.suspended') : t('workspace.pending')})`
              : ''}
          </option>
        )}
        {workspaces.map((workspace) => (
          <option key={workspace.tenantId} value={workspace.tenantId}>
            {workspace.name} · {t(KIND_KEY[workspace.kind])}
            {workspace.restricted ? ` (${t('workspace.pending')})` : ''}
          </option>
        ))}
      </Select>
      {kindLabel ? (
        <Badge tone={restricted ? 'warning' : 'neutral'} className="hidden lg:inline-flex">
          {kindLabel}
          {restricted ? ` · ${t('workspace.pending')}` : ''}
        </Badge>
      ) : null}
    </div>
  );
}
