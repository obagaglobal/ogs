import type { MfaStatusResponse, SessionListResponse } from '@ogs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Notice } from '@/components/ui/form-controls';
import { api, describeError } from '@/lib/api';

/** Signed-in devices and two-step verification status. */
export function SecurityPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => (await api<SessionListResponse>('/auth/sessions')).sessions,
  });
  const mfa = useQuery({
    queryKey: ['auth', 'mfa'],
    queryFn: async () => api<MfaStatusResponse>('/auth/mfa'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
  const revoke = useMutation({
    mutationFn: async (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const revokeOthers = useMutation({
    mutationFn: async () => api('/auth/sessions/revoke-others', { method: 'POST' }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>

      <Card>
        <h2 className="mb-2 font-medium">Two-step verification</h2>
        {mfa.data?.enrolled ? (
          <p className="text-sm">
            On. {mfa.data.recoveryCodesRemaining} recovery code
            {mfa.data.recoveryCodesRemaining === 1 ? '' : 's'} left.
          </p>
        ) : (
          <p className="text-sm">
            Off.{' '}
            <Link to="/mfa/setup" className="underline underline-offset-4">
              Turn it on
            </Link>
            {mfa.data?.required ? ' (required for your role)' : ''}
          </p>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-medium">Where you are signed in</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              revokeOthers.mutate();
            }}
            disabled={revokeOthers.isPending}
          >
            Sign out everywhere else
          </Button>
        </div>
        {sessions.isError || revoke.isError ? (
          <Notice tone="error">{describeError(sessions.error ?? revoke.error)}</Notice>
        ) : null}
        <ul className="divide-y">
          {(sessions.data ?? []).map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div>
                <p className="font-medium">
                  {session.userAgent ?? 'Unknown device'}
                  {session.current ? ' · this device' : ''}
                </p>
                <p className="text-muted-foreground">
                  {session.ip ?? 'unknown IP'} · last active{' '}
                  {new Date(session.lastSeenAt).toLocaleString()}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    revoke.mutate(session.id);
                  }}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
