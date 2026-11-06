import type {
  AcceptInvitationResponse,
  DepartmentListResponse,
  InvitationListResponse,
  MemberListResponse,
  PermissionListResponse,
  RoleListResponse,
} from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { useSession, useSessionChanged } from '@/features/auth/session';
import { useCan, useWorkspace } from '@/features/workspace/workspace-state';
import { api, describeError } from '@/lib/api';

function useRoles(workspace: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workspace', workspace, 'roles'],
    queryFn: async () => (await api<RoleListResponse>('/workspace/roles', { workspace })).roles,
    enabled,
  });
}

// ---------------------------------------------------------------------------- members

/** /team — members, invitations and their roles. */
export function MembersPage() {
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  const canManage = useCan('membership.manage');
  const canInvite = useCan('membership.invite');
  const canRoles = useCan('role.manage');
  const members = useQuery({
    queryKey: ['workspace', selected, 'members'],
    queryFn: async () =>
      (await api<MemberListResponse>('/workspace/members', { workspace: selected })).members,
  });
  const roles = useRoles(selected, canInvite || canRoles);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workspace', selected] });
  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' | 'ENDED' }) =>
      api(`/workspace/members/${id}`, { method: 'PATCH', body: { status }, workspace: selected }),
    onSuccess: refresh,
  });
  const setRole = useMutation({
    mutationFn: async ({ id, roleId }: { id: string; roleId: string }) =>
      api(`/workspace/members/${id}/roles`, {
        method: 'PUT',
        body: { roleIds: [roleId] },
        workspace: selected,
      }),
    onSuccess: refresh,
  });

  if (members.isError) {
    return <Notice tone="error">{describeError(members.error)}</Notice>;
  }
  const failure = update.error ?? setRole.error;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
      {failure ? <Notice tone="error">{describeError(failure)}</Notice> : null}
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Member</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {(members.data ?? []).map((member) => (
              <tr key={member.membershipId}>
                <td className="py-2">{member.email}</td>
                <td className="py-2">
                  {canRoles && roles.data ? (
                    <select
                      aria-label={`Role of ${member.email}`}
                      value={roles.data.find((role) => role.code === member.roles[0])?.id ?? ''}
                      onChange={(event) => {
                        setRole.mutate({ id: member.membershipId, roleId: event.target.value });
                      }}
                      className="h-8 rounded-md border bg-background px-2"
                    >
                      {roles.data.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-mono">{member.roles.join(', ')}</span>
                  )}
                </td>
                <td className="py-2">{member.status.toLowerCase()}</td>
                <td className="py-2 text-right">
                  {canManage && member.status !== 'ENDED' ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          update.mutate({
                            id: member.membershipId,
                            status: member.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                          });
                        }}
                      >
                        {member.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          update.mutate({ id: member.membershipId, status: 'ENDED' });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {canInvite ? <Invitations workspace={selected} roles={roles.data ?? []} /> : null}
    </div>
  );
}

function Invitations({
  workspace,
  roles,
}: {
  workspace: string;
  roles: RoleListResponse['roles'];
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const invitations = useQuery({
    queryKey: ['workspace', workspace, 'invitations'],
    queryFn: async () =>
      (await api<InvitationListResponse>('/workspace/invitations', { workspace })).invitations,
  });
  // Until someone picks a role, offer the least-privileged built-in one (employee / technician).
  const basicRole = roles.find((role) => role.isSystem && /employee|technician/.test(role.code));
  const chosenRoleId = roleId !== '' ? roleId : (basicRole?.id ?? '');
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace', workspace, 'invitations'] });
  const invite = useMutation({
    mutationFn: async () =>
      api('/workspace/invitations', {
        method: 'POST',
        body: { email, roleIds: [chosenRoleId] },
        workspace,
      }),
    onSuccess: async () => {
      setEmail('');
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) =>
      api(`/workspace/invitations/${id}`, { method: 'DELETE', workspace }),
    onSuccess: refresh,
  });

  return (
    <Card>
      <h2 className="mb-3 font-medium">Invite someone</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          invite.mutate();
        }}
      >
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          className="min-w-64 flex-1"
          required
        />
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            value={chosenRoleId}
            onChange={(event) => {
              setRoleId(event.target.value);
            }}
            className="h-10 rounded-md border bg-background px-2 text-sm"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={invite.isPending || chosenRoleId === ''}>
          Send invitation
        </Button>
      </form>
      {invite.isError ? (
        <div className="mt-3">
          <Notice tone="error">{describeError(invite.error)}</Notice>
        </div>
      ) : null}
      {invite.isSuccess ? (
        <div className="mt-3">
          <Notice tone="success">Invitation sent. It is valid for 7 days.</Notice>
        </div>
      ) : null}
      <ul className="mt-4 divide-y text-sm">
        {(invitations.data ?? [])
          .filter((invitation) => invitation.status === 'PENDING')
          .map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between py-2">
              <span>
                {invitation.email} · {invitation.roles.join(', ')} · expires{' '}
                {new Date(invitation.expiresAt).toLocaleDateString()}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  revoke.mutate(invitation.id);
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------- roles

/** /team/roles — custom roles built from the permissions this workspace kind allows. */
export function RolesPage() {
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  const canManage = useCan('role.manage');
  const roles = useRoles(selected, true);
  const permissions = useQuery({
    queryKey: ['workspace', selected, 'permissions'],
    queryFn: async () =>
      (await api<PermissionListResponse>('/workspace/permissions', { workspace: selected }))
        .permissions,
  });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace', selected, 'roles'] });
  const create = useMutation({
    mutationFn: async () =>
      api('/workspace/roles', {
        method: 'POST',
        body: { code, name, permissions: chosen },
        workspace: selected,
      }),
    onSuccess: async () => {
      setName('');
      setCode('');
      setChosen([]);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      api(`/workspace/roles/${id}`, { method: 'DELETE', workspace: selected }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
      {roles.isError || remove.isError ? (
        <Notice tone="error">{describeError(roles.error ?? remove.error)}</Notice>
      ) : null}
      <Card>
        <ul className="divide-y text-sm">
          {(roles.data ?? []).map((role) => (
            <li key={role.id} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="font-medium">
                  {role.name}{' '}
                  {role.isSystem ? <span className="text-muted-foreground">· built-in</span> : null}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {role.permissions.join(', ')}
                </p>
              </div>
              {canManage && !role.isSystem ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    remove.mutate(role.id);
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {canManage ? (
        <Card>
          <h2 className="mb-3 font-medium">New custom role</h2>
          <form
            className="space-y-4"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            {create.isError ? <Notice tone="error">{describeError(create.error)}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                required
              />
              <Field
                label="Code"
                hint="Lower-case letters, digits and _"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
                required
              />
            </div>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">Permissions</legend>
              {(permissions.data ?? []).map((permission) => (
                <label key={permission.code} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.includes(permission.code)}
                    onChange={(event) => {
                      setChosen(
                        event.target.checked
                          ? [...chosen, permission.code]
                          : chosen.filter((code) => code !== permission.code),
                      );
                    }}
                  />
                  <span>
                    <span className="font-mono text-xs">{permission.code}</span>
                    <br />
                    <span className="text-muted-foreground">{permission.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={create.isPending || chosen.length === 0}>
              Create role
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------- departments

/** /team/departments — a flat list; archived instead of deleted (P4-5). */
export function DepartmentsPage() {
  const { selected } = useWorkspace();
  const queryClient = useQueryClient();
  const canManage = useCan('department.manage');
  const [name, setName] = useState('');
  const departments = useQuery({
    queryKey: ['workspace', selected, 'departments'],
    queryFn: async () =>
      (await api<DepartmentListResponse>('/workspace/departments', { workspace: selected }))
        .departments,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace', selected, 'departments'] });
  const create = useMutation({
    mutationFn: async () =>
      api('/workspace/departments', { method: 'POST', body: { name }, workspace: selected }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      api(`/workspace/departments/${id}`, {
        method: 'PATCH',
        body: { archived },
        workspace: selected,
      }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
      {departments.isError ? (
        <Notice tone="error">{describeError(departments.error)}</Notice>
      ) : null}
      <Card>
        <ul className="divide-y text-sm">
          {(departments.data ?? []).map((department) => (
            <li key={department.id} className="flex items-center justify-between py-2">
              <span className={department.archived ? 'text-muted-foreground line-through' : ''}>
                {department.name} · {department.memberCount} member
                {department.memberCount === 1 ? '' : 's'}
              </span>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    archive.mutate({ id: department.id, archived: !department.archived });
                  }}
                >
                  {department.archived ? 'Restore' : 'Archive'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="mt-4 flex items-end gap-3"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Field
              label="New department"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="flex-1"
              required
            />
            <Button type="submit" disabled={create.isPending}>
              Add
            </Button>
          </form>
        ) : null}
        {create.isError ? <Notice tone="error">{describeError(create.error)}</Notice> : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- invitations

const PENDING_INVITATION_KEY = 'ogs.pendingInvitation';

/**
 * /invitations/accept#token=…&email=… — the token stays in the fragment. If the
 * visitor is signed out it is kept in sessionStorage (this tab only) while
 * they sign in or sign up with the invited address, then accepted.
 */
export function AcceptInvitationPage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const sessionChanged = useSessionChanged();
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const token = fragment.get('token') ?? sessionStorage.getItem(PENDING_INVITATION_KEY) ?? '';
  const email = fragment.get('email') ?? '';
  useEffect(() => {
    if (token !== '') {
      sessionStorage.setItem(PENDING_INVITATION_KEY, token);
    }
  }, [token]);

  const accept = useMutation({
    mutationFn: async () =>
      api<AcceptInvitationResponse>('/invitations/accept', { method: 'POST', body: { token } }),
    onSuccess: async (result) => {
      sessionStorage.removeItem(PENDING_INVITATION_KEY);
      localStorage.setItem('ogs.workspace', result.tenantId);
      await sessionChanged();
      await navigate('/', { replace: true });
    },
  });

  const next = encodeURIComponent('/invitations/accept');
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Join a workspace on OGS</h1>
      {token === '' ? <Notice tone="error">This invitation link is incomplete.</Notice> : null}
      {accept.isError ? <Notice tone="error">{describeError(accept.error)}</Notice> : null}
      {session.data ? (
        session.data.user.status === 'ACTIVE' ? (
          <>
            <p className="text-sm">
              Signed in as <strong>{session.data.user.email}</strong>.
            </p>
            <Button
              disabled={token === '' || accept.isPending}
              onClick={() => {
                accept.mutate();
              }}
            >
              Accept invitation
            </Button>
          </>
        ) : (
          <Notice>
            Confirm your email address first (check your inbox), then open this page again.
          </Notice>
        )
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            The invitation is for <strong>{email || 'your email address'}</strong>.
          </p>
          <p>
            <Link className="underline" to={`/sign-in?next=${next}`}>
              Sign in
            </Link>{' '}
            or{' '}
            <Link className="underline" to={`/sign-up?email=${encodeURIComponent(email)}`}>
              create an account
            </Link>{' '}
            with that address.
          </p>
        </div>
      )}
    </main>
  );
}
