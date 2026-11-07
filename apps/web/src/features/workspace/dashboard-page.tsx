import type { CurrentWorkspaceResponse } from '@ogs/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, LayoutGrid, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { StatTile } from '@/components/ui/data-display';
import { Alert, ErrorState, Skeleton } from '@/components/ui/feedback';
import { useSession } from '@/features/auth/session';
import { habari, t } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { PROVIDER_WORKSPACE, useWorkspace } from './workspace-state';

const NEXT_STEPS: Record<CurrentWorkspaceResponse['kind'], string> = {
  personal: 'Your personal workspace: request ICT services and follow them to completion.',
  ORGANISATION: 'Your organisation workspace: requests, team, roles and departments.',
  PROVIDER_COMPANY:
    'Provider company workspace: your company profile, skills, coverage, availability and team.',
  PLATFORM: 'OGS platform workspace: reviews, catalogue, requests and finance.',
  provider: 'Your provider workspace: your application, skills, coverage and availability.',
};

const KIND_LABEL: Record<CurrentWorkspaceResponse['kind'], string> = {
  personal: t('workspace.kind.personal'),
  ORGANISATION: t('workspace.kind.organisation'),
  PROVIDER_COMPANY: t('workspace.kind.providerCompany'),
  PLATFORM: t('workspace.kind.platform'),
  provider: t('workspace.kind.provider'),
};

/** A large link card for the one or two things people come here to do. */
function ActionCard({
  to,
  icon,
  title,
  body,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  body: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      {...(onClick ? { onClick } : {})}
      className="group flex gap-4 rounded-md border border-border bg-surface p-5 motion-fast transition-colors hover:border-ink"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-muted text-ink group-hover:bg-saffron group-hover:text-on-saffron [&_svg]:size-5"
      >
        {icon}
      </span>
      <span className="space-y-1">
        <span className="flex items-center gap-1 font-display font-medium">
          {title}
          <ArrowRight
            aria-hidden="true"
            className="size-4 motion-fast transition-transform group-hover:translate-x-0.5"
          />
        </span>
        <span className="block text-sm text-muted-foreground">{body}</span>
      </span>
    </Link>
  );
}

/** Entry points for offering ICT services through OGS (Phase 5). */
function ProviderInvitation() {
  const { provider, select } = useWorkspace();
  return provider === null ? (
    <>
      <ActionCard
        to="/providers/new"
        icon={<Wrench />}
        title="Become a provider"
        body="Technicians can receive work from OGS once verified."
      />
      <ActionCard
        to="/providers/companies/new"
        icon={<Building2 />}
        title="Register a provider company"
        body="ICT firms: offer your team's skills through OGS."
      />
    </>
  ) : (
    <>
      <ActionCard
        to="/provider"
        icon={<Wrench />}
        title="Open your Provider workspace"
        body={`Your provider profile is ${provider.status.toLowerCase().replace('_', ' ')}.`}
        onClick={() => {
          select(PROVIDER_WORKSPACE);
        }}
      />
      <ActionCard
        to="/providers/companies/new"
        icon={<Building2 />}
        title="Register a provider company"
        body="ICT firms: offer your team's skills through OGS."
      />
    </>
  );
}

/** Home for each workspace kind: greeting, context, and where to go next. */
export function DashboardPage() {
  const { selected } = useWorkspace();
  const session = useSession();
  const workspace = useQuery({
    queryKey: ['workspace', selected],
    queryFn: async () => api<CurrentWorkspaceResponse>('/workspace', { workspace: selected }),
    retry: false,
  });

  if (workspace.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (workspace.isError) {
    return <ErrorState body={describeError(workspace.error)} />;
  }
  const data = workspace.data;
  if (!data) {
    return null;
  }
  const customer = data.kind === 'personal' || (data.kind === 'ORGANISATION' && !data.restricted);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="font-display text-lg text-muted-foreground">
          {habari(session.data?.user.email)}
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {data.kind === 'personal'
            ? 'Personal'
            : data.kind === 'provider'
              ? 'Provider'
              : data.name}
        </h1>
        <p className="max-w-2xl text-muted-foreground">{NEXT_STEPS[data.kind]}</p>
      </header>

      {data.kind !== 'personal' && data.restricted ? (
        <Alert tone="warning" title="Waiting for OGS approval">
          This workspace is {data.status.toLowerCase().replace('_', ' ')}. You can see its status,
          but nothing else until OGS approves it.{' '}
          {data.kind === 'ORGANISATION' ? (
            <Link className="underline underline-offset-4" to="/organisation/application">
              Open the application
            </Link>
          ) : null}
          {data.kind === 'PROVIDER_COMPANY' || data.kind === 'provider' ? (
            <Link className="underline underline-offset-4" to="/provider">
              Open the application
            </Link>
          ) : null}
        </Alert>
      ) : null}

      {customer ? (
        <section aria-labelledby="next-heading" className="space-y-3">
          <h2 id="next-heading" className="font-display text-lg font-medium">
            Get things done
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ActionCard
              to="/services"
              icon={<LayoutGrid />}
              title="Find a service"
              body="Wi-Fi, networks, CCTV, repairs and more, with clear prices in KES."
            />
            {data.kind === 'personal' ? (
              <ActionCard
                to="/organisations/new"
                icon={<Building2 />}
                title="Register an organisation"
                body="Working for a company? Order services and manage your team on OGS."
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {data.kind === 'personal' ? (
        <section aria-labelledby="provide-heading" className="space-y-3">
          <h2 id="provide-heading" className="font-display text-lg font-medium">
            Offer ICT services through OGS
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ProviderInvitation />
          </div>
        </section>
      ) : null}

      {'roles' in data ? (
        <section aria-labelledby="access-heading" className="space-y-3">
          <h2 id="access-heading" className="font-display text-lg font-medium">
            Your access here
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Workspace type" value={KIND_LABEL[data.kind]} />
            <StatTile label="Permissions" value={data.permissions.length} />
            <Card className="p-4 sm:p-4">
              <p className="font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Roles
              </p>
              <p className="tabular mt-1 text-sm">{data.roles.join(', ') || 'none'}</p>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}
