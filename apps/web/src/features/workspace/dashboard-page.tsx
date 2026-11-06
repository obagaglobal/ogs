import type { CurrentWorkspaceResponse } from '@ogs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, Notice } from '@/components/ui/form-controls';
import { api, describeError } from '@/lib/api';
import { PROVIDER_WORKSPACE, useWorkspace } from './workspace-state';

const NEXT_STEPS: Record<CurrentWorkspaceResponse['kind'], string> = {
  personal: 'Your personal workspace. Ordering services arrives with the catalogue (Phase 6).',
  ORGANISATION: 'Organisation workspace. Members, departments and approvals arrive in Phase 4.',
  PROVIDER_COMPANY:
    'Provider company workspace: your company profile, skills, coverage, availability and team.',
  PLATFORM: 'OGS platform workspace. Administration tools arrive in later phases.',
  provider: 'Your provider workspace: your application, skills, coverage and availability.',
};

/** Entry points for offering ICT services through OGS (Phase 5). */
function ProviderInvitation() {
  const { provider, select } = useWorkspace();
  return (
    <Card>
      <h2 className="mb-1 font-medium">Offer ICT services through OGS</h2>
      {provider === null ? (
        <p className="text-sm text-muted-foreground">
          Technicians and ICT firms can receive work from OGS once verified.{' '}
          <Link className="underline" to="/providers/new">
            Become a provider
          </Link>{' '}
          or{' '}
          <Link className="underline" to="/providers/companies/new">
            Register a provider company
          </Link>
          .
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          You have a provider profile ({provider.status.toLowerCase().replace('_', ' ')}).{' '}
          <Link
            className="underline"
            to="/provider"
            onClick={() => {
              select(PROVIDER_WORKSPACE);
            }}
          >
            Open your Provider workspace
          </Link>{' '}
          or{' '}
          <Link className="underline" to="/providers/companies/new">
            Register a provider company
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

/** Placeholder home for each workspace kind (Phase 3 plan §3.4). */
export function DashboardPage() {
  const { selected } = useWorkspace();
  const workspace = useQuery({
    queryKey: ['workspace', selected],
    queryFn: async () => api<CurrentWorkspaceResponse>('/workspace', { workspace: selected }),
    retry: false,
  });

  if (workspace.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workspace…</p>;
  }
  if (workspace.isError) {
    return <Notice tone="error">{describeError(workspace.error)}</Notice>;
  }
  const data = workspace.data;
  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.kind === 'personal'
            ? 'Personal'
            : data.kind === 'provider'
              ? 'Provider'
              : data.name}
        </h1>
        <p className="text-sm text-muted-foreground">{NEXT_STEPS[data.kind]}</p>
      </div>
      {data.kind !== 'personal' && data.restricted ? (
        <Notice>
          This workspace is {data.status.toLowerCase().replace('_', ' ')}. You can see its status,
          but nothing else until OGS approves it.{' '}
          {data.kind === 'ORGANISATION' ? (
            <Link className="underline" to="/organisation/application">
              Open the application
            </Link>
          ) : null}
          {data.kind === 'PROVIDER_COMPANY' || data.kind === 'provider' ? (
            <Link className="underline" to="/provider">
              Open the application
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {data.kind === 'personal' ? (
        <Card>
          <h2 className="mb-1 font-medium">Working for a company?</h2>
          <p className="text-sm text-muted-foreground">
            Register your organisation to order services and manage your team on OGS.{' '}
            <Link className="underline" to="/organisations/new">
              Register an organisation
            </Link>
          </p>
        </Card>
      ) : null}
      {data.kind === 'personal' ? <ProviderInvitation /> : null}
      {'roles' in data ? (
        <Card>
          <h2 className="mb-2 font-medium">Your access here</h2>
          <p className="text-sm">
            Roles: <span className="font-mono">{data.roles.join(', ') || 'none'}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {data.permissions.length} permission{data.permissions.length === 1 ? '' : 's'} granted.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
