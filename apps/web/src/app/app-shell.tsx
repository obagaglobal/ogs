import { useMutation } from '@tanstack/react-query';
import { Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Shield } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/data-display';
import { PageLoader, RouteFallback } from '@/components/ui/feedback';
import { Notice } from '@/components/ui/form-controls';
import {
  Drawer,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/overlays';
import { useSession, useSessionChanged } from '@/features/auth/session';
import { AuthLayout } from '@/features/auth/auth-layout';
import { WorkspaceProvider } from '@/features/workspace/workspace-context';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { WorkspaceSwitcher } from '@/features/workspace/workspace-switcher';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeChoice } from '@/theme/theme';
import { WorkspaceNav } from './workspace-nav';

/**
 * Everything behind sign-in. Sends people where the API says they must go:
 * second factor owed → /mfa; enrolment required → /mfa/setup; email not
 * verified → /verify-email/pending.
 */
export function SignedInGate() {
  const session = useSession();
  if (session.isLoading) {
    return <PageLoader />;
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

/** The first focusable element on every page (WCAG 2.4.1). */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-[60] rounded-md bg-saffron px-4 py-2 font-display font-medium text-on-saffron focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      {t('shell.skipToContent')}
    </a>
  );
}

const SIDEBAR_KEY = 'ogs.sidebar';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="flex min-h-11 items-center gap-2 rounded-md font-display text-lg font-bold tracking-tight"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 items-center justify-center rounded-sm bg-ink text-sm text-saffron"
      >
        O
      </span>
      <span className={cn(compact && 'sr-only')}>{t('shell.brand')}</span>
    </Link>
  );
}

/**
 * Signed-in layout (Phase 6b): a collapsible sidebar from md up, a drawer on
 * phones, and a top bar with the workspace switcher, a search placeholder,
 * notifications and the account menu (theme lives there). No motif here:
 * workspaces stay calm (rule 4.4).
 */
function AppShell({ email }: { email: string }) {
  const navigate = useNavigate();
  const sessionChanged = useSessionChanged();
  const { error } = useWorkspace();
  const { choice, setChoice } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
      return next;
    });
  }

  return (
    <div className="min-h-svh bg-paper text-ink md:flex">
      <SkipLink />
      <aside
        className={cn(
          'sticky top-0 hidden h-svh shrink-0 flex-col border-r border-border bg-surface px-3 py-3 md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('mb-4 flex items-center', collapsed ? 'justify-center' : 'px-1')}>
          <Brand compact={collapsed} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <WorkspaceNav collapsed={collapsed} />
        </div>
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          className={cn('mt-2', !collapsed && 'justify-start')}
          aria-label={collapsed ? t('shell.expand') : t('shell.collapse')}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          {collapsed ? null : <span>{t('shell.collapse')}</span>}
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-paper/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={t('shell.openMenu')}
              onClick={() => {
                setDrawerOpen(true);
              }}
            >
              <Menu aria-hidden="true" />
            </Button>
            <WorkspaceSwitcher />
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <div
                aria-disabled="true"
                title={t('shell.searchPlaceholder')}
                className="hidden min-h-9 w-56 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground lg:flex"
              >
                <Search aria-hidden="true" className="size-4" />
                <span>{t('shell.searchPlaceholder')}</span>
              </div>
              <MenuRoot>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('shell.notifications')}>
                    <Bell aria-hidden="true" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>{t('shell.notifications')}</MenuLabel>
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t('shell.noNotifications')}
                  </p>
                </MenuContent>
              </MenuRoot>
              <MenuRoot>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('shell.userMenu')}>
                    <Avatar name={email} size={30} />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel className="truncate text-ink">{email}</MenuLabel>
                  <MenuSeparator />
                  <MenuItem
                    onSelect={() => {
                      void navigate('/security');
                    }}
                  >
                    <Shield aria-hidden="true" />
                    {t('shell.security')}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuLabel>{t('shell.theme')}</MenuLabel>
                  <MenuRadioGroup
                    value={choice}
                    onValueChange={(value) => {
                      setChoice(value as ThemeChoice);
                    }}
                  >
                    <MenuRadioItem value="light">{t('shell.theme.light')}</MenuRadioItem>
                    <MenuRadioItem value="dark">{t('shell.theme.dark')}</MenuRadioItem>
                    <MenuRadioItem value="system">{t('shell.theme.system')}</MenuRadioItem>
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuItem
                    onSelect={() => {
                      signOut.mutate();
                    }}
                  >
                    <LogOut aria-hidden="true" />
                    {t('shell.signOut')}
                  </MenuItem>
                </MenuContent>
              </MenuRoot>
            </div>
          </div>
        </header>

        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={t('shell.brandLong')}
          side="left"
        >
          <WorkspaceNav
            onNavigate={() => {
              setDrawerOpen(false);
            }}
          />
        </Drawer>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
        >
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
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
    <AuthLayout title="Confirm your email">
      <p className="text-sm text-muted-foreground">
        We sent a link to {session.data?.user.email ?? 'your inbox'}. Open it to start using OGS.
      </p>
      {resend.isSuccess ? <Notice tone="success">A new link is on its way.</Notice> : null}
      <Button
        variant="secondary"
        onClick={() => {
          resend.mutate();
        }}
        disabled={resend.isPending}
      >
        Send the link again
      </Button>
    </AuthLayout>
  );
}
