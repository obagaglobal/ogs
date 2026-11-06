import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/form-controls';
import { useSession, useSessionChanged } from '@/features/auth/session';
import { WorkspaceProvider } from '@/features/workspace/workspace-context';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { WorkspaceSwitcher } from '@/features/workspace/workspace-switcher';
import { api, ApiError } from '@/lib/api';
import { WorkspaceNav } from './workspace-nav';

/**
 * Everything behind sign-in. Sends people where the API says they must go:
 * second factor owed → /mfa; enrolment required → /mfa/setup; email not
 * verified → /verify-email/pending.
 */
export function SignedInGate() {
  const session = useSession();
  if (session.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!session.data) {
    return <Navigate to="/sign-in" replace />;
  }
  if (session.data.session.mfaPending) {
    return <Navigate to="/mfa" replace />;
  }
  if (session.data.user.status === 'PENDING_VERIFICATION') {
    return <Navigate to="/verify-email/pending" replace />;
  }
  return (
    <WorkspaceProvider>
      <AppShell email={session.data.user.email} />
    </WorkspaceProvider>
  );
}

function AppShell({ email }: { email: string }) {
  const navigate = useNavigate();
  const sessionChanged = useSessionChanged();
  const { error } = useWorkspace();
  const signOut = useMutation({
    mutationFn: async () => api('/auth/logout', { method: 'POST' }),
    onSettled: async () => {
      await sessionChanged();
      await navigate('/sign-in', { replace: true });
    },
  });

  if (error instanceof ApiError && error.code === 'mfa_enrollment_required') {
    return <Navigate to="/mfa/setup" replace />;
  }

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            OGS
          </Link>
          <WorkspaceSwitcher />
          <nav aria-label="Account" className="flex items-center gap-4 text-sm">
            <NavLink to="/security" className="underline-offset-4 hover:underline">
              Security
            </NavLink>
            <span className="hidden text-muted-foreground sm:inline">{email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                signOut.mutate();
              }}
            >
              Sign out
            </Button>
          </nav>
        </div>
        <div className="mx-auto max-w-5xl px-6 pb-2">
          <WorkspaceNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

/** Shown to signed-in users whose email is not confirmed yet (decision P3-7). */
export function VerifyPendingPage() {
  const session = useSession();
  const resend = useMutation({
    mutationFn: async () => api('/auth/resend-verification', { method: 'POST' }),
  });
  if (session.data?.user.status === 'ACTIVE') {
    return <Navigate to="/" replace />;
  }
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Confirm your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a link to {session.data?.user.email ?? 'your inbox'}. Open it to start using OGS.
      </p>
      {resend.isSuccess ? <Notice tone="success">A new link is on its way.</Notice> : null}
      <Button
        variant="outline"
        onClick={() => {
          resend.mutate();
        }}
        disabled={resend.isPending}
      >
        Send the link again
      </Button>
    </main>
  );
}
