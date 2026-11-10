import type { CurrentWorkspaceResponse } from '@ogs/contracts';
import {
  BookOpen,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  HardHat,
  Headset,
  Inbox,
  House,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  MapPin,
  Network,
  Receipt,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/**
 * The sections the current workspace allows (the server still checks every
 * call). Pure, so the sidebar and the mobile drawer render the same list.
 */
export function navItemsFor(data: CurrentWorkspaceResponse | undefined): NavItem[] {
  const can = (code: string) =>
    data !== undefined &&
    'permissions' in data &&
    !data.restricted &&
    data.permissions.includes(code);
  const platform = data?.kind === 'PLATFORM';
  // The individual Provider workspace, or a provider company the member can see.
  const providerArea =
    data !== undefined &&
    (data.kind === 'provider' ||
      (data.kind === 'PROVIDER_COMPANY' && data.permissions.includes('workspace.read')));

  const items: (NavItem | false)[] = [
    { to: '/', label: t('nav.home'), icon: House, end: true },
    { to: '/services', label: t('nav.services'), icon: LayoutGrid },
    (data?.kind === 'personal' || (data?.kind === 'ORGANISATION' && !data.restricted)) && {
      to: '/requests',
      label: t('nav.requests'),
      icon: ClipboardList,
    },
    (data?.kind === 'personal' || (data?.kind === 'ORGANISATION' && can('ticket.read'))) && {
      to: '/support',
      label: t('nav.support'),
      icon: LifeBuoy,
    },
    data?.kind === 'ORGANISATION' &&
      data.permissions.includes('organisation.profile.manage') && {
        to: '/organisation/application',
        label: data.restricted ? t('nav.application') : t('nav.organisation'),
        icon: data.restricted ? FileText : Building2,
      },
    can('membership.read') && { to: '/team', label: t('nav.team'), icon: Users, end: true },
    can('role.read') && { to: '/team/roles', label: t('nav.roles'), icon: ShieldCheck },
    data?.kind === 'ORGANISATION' &&
      can('membership.read') && {
        to: '/team/departments',
        label: t('nav.departments'),
        icon: Network,
      },
    providerArea && {
      to: '/provider',
      label: data.restricted ? t('nav.application') : t('nav.profileSkills'),
      icon: data.restricted ? FileText : UserCog,
      end: true,
    },
    providerArea && { to: '/provider/coverage', label: t('nav.coverage'), icon: MapPin },
    // Phase 9: whoever works jobs — an ACTIVE individual provider, a company
    // member who answers offers, dispatches or works, an OGS technician.
    ((data?.kind === 'provider' && !data.restricted) ||
      (data?.kind === 'PROVIDER_COMPANY' &&
        (can('assignment.respond') || can('ticket.update_progress') || can('ticket.assign'))) ||
      (platform && can('assignment.respond'))) && {
      to: '/jobs',
      label: t('nav.jobs'),
      icon: HardHat,
    },
    providerArea && {
      to: '/provider/availability',
      label: t('nav.availability'),
      icon: CalendarClock,
    },
    platform &&
      can('platform.tenant.review') && {
        to: '/platform/applications',
        label: t('nav.applications'),
        icon: Inbox,
      },
    platform &&
      can('ticket.assign') && {
        to: '/platform/eligibility',
        label: t('nav.eligibility'),
        icon: ListChecks,
      },
    platform &&
      can('ticket.assign') && {
        to: '/platform/dispatch',
        label: t('nav.dispatch'),
        icon: Truck,
      },
    platform &&
      can('ticket.read') && {
        to: '/platform/tickets',
        label: t('nav.tickets'),
        icon: Headset,
      },
    platform &&
      can('platform.quotation.issue') && {
        to: '/platform/requests',
        label: t('nav.staffRequests'),
        icon: ClipboardList,
      },
    platform &&
      can('platform.finance.manage') && {
        to: '/platform/orders',
        label: t('nav.orders'),
        icon: Receipt,
      },
    platform &&
      can('platform.catalogue.manage') && {
        to: '/platform/catalogue',
        label: t('nav.catalogue'),
        icon: BookOpen,
      },
    platform &&
      can('platform.catalogue.manage') && {
        to: '/platform/skills',
        label: t('nav.skills'),
        icon: Wrench,
      },
  ];
  return items.filter((item): item is NavItem => item !== false);
}
