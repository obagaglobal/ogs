import { NavLink } from 'react-router';
import { t } from '@/i18n';
import { useCurrentWorkspace } from '@/features/workspace/workspace-state';
import { cn } from '@/lib/utils';
import { navItemsFor } from './nav-items';

/**
 * The workspace's sections, vertical (sidebar and mobile drawer). Active link:
 * ink text, surface-muted fill and a saffron bar. When collapsed only icons
 * show; the label stays as the accessible name.
 */
export function WorkspaceNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { data } = useCurrentWorkspace();
  return (
    <nav aria-label={t('shell.navigation')}>
      <ul className="space-y-0.5">
        {navItemsFor(data).map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end ?? false}
              {...(onNavigate ? { onClick: onNavigate } : {})}
              {...(collapsed ? { title: label } : {})}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground motion-fast transition-colors hover:bg-surface-muted hover:text-ink md:min-h-9',
                  collapsed && 'justify-center px-0',
                  isActive &&
                    'bg-surface-muted font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-saffron',
                )
              }
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className={cn(collapsed && 'sr-only')}>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
