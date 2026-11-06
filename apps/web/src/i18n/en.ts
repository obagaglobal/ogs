/**
 * English UI strings (ADR-024: English first, i18n-ready). Keys are stable
 * identifiers; a Swahili catalogue (sw.ts) can be added later with the same
 * keys. Placeholders use {name}. Sentence case, plain and friendly.
 */
export const en = {
  // Voice: short Swahili greetings (Phase 6b).
  'greeting.karibu': 'Karibu',
  'greeting.karibuTo': 'Karibu to OGS',
  'greeting.habari': 'Habari, {name}',
  'greeting.habariPlain': 'Habari',

  // App shell.
  'shell.skipToContent': 'Skip to content',
  'shell.brand': 'OGS',
  'shell.brandLong': 'ObagaGlobal Services',
  'shell.openMenu': 'Open navigation',
  'shell.closeMenu': 'Close navigation',
  'shell.collapse': 'Collapse sidebar',
  'shell.expand': 'Expand sidebar',
  'shell.search': 'Search',
  'shell.searchPlaceholder': 'Search — coming soon',
  'shell.notifications': 'Notifications',
  'shell.noNotifications': 'No notifications yet.',
  'shell.userMenu': 'Account menu',
  'shell.security': 'Security',
  'shell.signOut': 'Sign out',
  'shell.theme': 'Theme',
  'shell.theme.light': 'Light',
  'shell.theme.dark': 'Dark',
  'shell.theme.system': 'System',
  'shell.loading': 'Loading OGS…',
  'shell.navigation': 'Main navigation',

  // Workspaces.
  'workspace.label': 'Workspace',
  'workspace.switch': 'Switch workspace',
  'workspace.current': 'Current workspace',
  'workspace.kind.personal': 'Personal',
  'workspace.kind.organisation': 'Organisation',
  'workspace.kind.provider': 'Provider',
  'workspace.kind.providerCompany': 'Provider company',
  'workspace.kind.platform': 'OGS Platform',
  'workspace.pending': 'pending',
  'workspace.suspended': 'suspended',

  // Navigation.
  'nav.home': 'Home',
  'nav.services': 'Browse services',
  'nav.requests': 'Requests',
  'nav.application': 'Application',
  'nav.organisation': 'Organisation',
  'nav.team': 'Team',
  'nav.roles': 'Roles',
  'nav.departments': 'Departments',
  'nav.profileSkills': 'Profile & skills',
  'nav.coverage': 'Coverage',
  'nav.availability': 'Availability',
  'nav.applications': 'Applications',
  'nav.staffRequests': 'Requests',
  'nav.orders': 'Orders',
  'nav.eligibility': 'Eligibility',
  'nav.catalogue': 'Catalogue',
  'nav.skills': 'Skills',

  // Public site.
  'public.allServices': 'All services',
  'public.signIn': 'Sign in',
  'public.openOgs': 'Open OGS',
  'public.heroTitle': 'Karibu. ICT help you can count on.',
  'public.heroBody':
    'Wi-Fi, networks, CCTV, computer repair, cloud and more — delivered by vetted OGS technicians, with clear prices in KES.',
  'public.searchLabel': 'Search services',
  'public.searchPlaceholder': 'e.g. Wi-Fi, CCTV, laptop repair',
  'public.searching': 'Updating results…',
  'public.resultsCount': '{count} services',
  'public.resultsOne': '1 service',
  'public.noResults': 'No services match. Try other words.',
  'public.loadMore': 'Load more',
  'public.categories': 'Categories',
  'public.pricesNote': 'Prices are in KES and exclude VAT.',
  'public.signInToRequest': 'Sign in to request',
  'public.requestService': 'Request this service',
  'public.notFound': '{what} not found',
  'public.notFoundBody': 'It may have been withdrawn.',
  'public.browseAll': 'Browse all services',

  // Common.
  'common.loading': 'Loading…',
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.optional': 'optional',
  'common.required': 'required',
  'common.previous': 'Previous',
  'common.next': 'Next',
  'common.page': 'Page {page} of {pages}',
  'common.sortAscending': 'sorted ascending',
  'common.sortDescending': 'sorted descending',
  'common.noData': 'Nothing here yet.',
  'common.errorTitle': 'Something went wrong',
  'common.errorBody': 'Please try again. If it keeps happening, contact OGS support.',
  'common.chooseDate': 'Choose a date',
  'common.chooseFile': 'Choose a file',
  'common.uploading': 'Uploading…',
  'common.noMatches': 'No matches.',

  // Status pills.
  'status.draft': 'Draft',
  'status.pending': 'Pending',
  'status.active': 'Active',
  'status.live': 'Live',
  'status.completed': 'Completed',
  'status.paid': 'Paid',
  'status.overdue': 'Overdue',
  'status.breached': 'Breached',
  'status.suspended': 'Suspended',

  // Auth.
  'auth.signInTitle': 'Karibu. Sign in to OGS',
  'auth.signUpTitle': 'Karibu. Create your OGS account',

  // Design system page.
  'design.title': 'Design system',
  'design.intro': 'Kitenge signal: every token, type style and component, in light and dark.',
} as const;

export type MessageKey = keyof typeof en;
