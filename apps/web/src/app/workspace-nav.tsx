import { NavLink } from 'react-router';
import { useCurrentWorkspace } from '@/features/workspace/workspace-state';
import { cn } from '@/lib/utils';

const link = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-md px-2 py-1 hover:bg-accent', isActive && 'bg-accent font-medium');

/** Links for what the current workspace allows (the server still checks every call). */
export function WorkspaceNav() {
  const { data } = useCurrentWorkspace();
  const can = (code: string) =>
    data !== undefined &&
    'permissions' in data &&
    !data.restricted &&
    data.permissions.includes(code);

  return (
    <nav aria-label="Workspace sections" className="flex flex-wrap gap-1 text-sm">
      <NavLink to="/" end className={link}>
        Home
      </NavLink>
      {data?.kind === 'ORGANISATION' && data.permissions.includes('organisation.profile.manage') ? (
        <NavLink to="/organisation/application" className={link}>
          {data.restricted ? 'Application' : 'Organisation'}
        </NavLink>
      ) : null}
      {can('membership.read') ? (
        <NavLink to="/team" end className={link}>
          Team
        </NavLink>
      ) : null}
      {can('role.read') ? (
        <NavLink to="/team/roles" className={link}>
          Roles
        </NavLink>
      ) : null}
      {data?.kind === 'ORGANISATION' && can('membership.read') ? (
        <NavLink to="/team/departments" className={link}>
          Departments
        </NavLink>
      ) : null}
      {data?.kind === 'PLATFORM' && can('platform.tenant.review') ? (
        <NavLink to="/platform/applications" className={link}>
          Applications
        </NavLink>
      ) : null}
    </nav>
  );
}
