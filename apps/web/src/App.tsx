import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { PageLoader } from '@/components/ui/feedback';

/**
 * Routes (Phase 6b): every area is its own chunk (React.lazy), so a visitor
 * opening /services downloads the catalogue and nothing else. The signed-in
 * shell and the public layout have their own Suspense boundary around the
 * page, so they stay on screen while a page chunk loads.
 */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const auth = {
  signIn: () => import('@/features/auth/sign-in-page'),
  signUp: () => import('@/features/auth/sign-up-page'),
  tokens: () => import('@/features/auth/email-token-pages'),
  mfa: () => import('@/features/auth/mfa-pages'),
};
const shell = () => import('@/app/app-shell');
const team = () => import('@/features/members/team-pages');
const organisation = () => import('@/features/organisation/organisation-pages');
const platform = () => import('@/features/platform/platform-pages');
const providerStaff = () => import('@/features/platform/provider-staff-pages');
const provider = () => import('@/features/provider/provider-pages');
const catalogue = () => import('@/features/catalogue/public-pages');
const catalogueStaff = () => import('@/features/platform/catalogue-staff-pages');
const orderStaff = () => import('@/features/platform/order-staff-pages');
const requests = () => import('@/features/requests/customer-request-pages');
const tickets = () => import('@/features/tickets/customer-ticket-pages');
const ticketStaff = () => import('@/features/tickets/staff-ticket-pages');
const jobs = () => import('@/features/jobs/assignee-pages');
const dispatch = () => import('@/features/jobs/dispatch-pages');

const SignInPage = page(auth.signIn, 'SignInPage');
const SignUpPage = page(auth.signUp, 'SignUpPage');
const ForgotPasswordPage = page(auth.tokens, 'ForgotPasswordPage');
const ResetPasswordPage = page(auth.tokens, 'ResetPasswordPage');
const VerifyEmailPage = page(auth.tokens, 'VerifyEmailPage');
const MfaPromptPage = page(auth.mfa, 'MfaPromptPage');
const MfaSetupPage = page(auth.mfa, 'MfaSetupPage');
const SecurityPage = page(() => import('@/features/auth/security-page'), 'SecurityPage');
const SignedInGate = page(shell, 'SignedInGate');
const VerifyPendingPage = page(shell, 'VerifyPendingPage');
const StatusPage = page(() => import('@/features/system-status/status-page'), 'StatusPage');
const AcceptInvitationPage = page(team, 'AcceptInvitationPage');
const DepartmentsPage = page(team, 'DepartmentsPage');
const MembersPage = page(team, 'MembersPage');
const RolesPage = page(team, 'RolesPage');
const ApplicationPage = page(organisation, 'ApplicationPage');
const RegisterOrganisationPage = page(organisation, 'RegisterOrganisationPage');
const ApplicationQueuePage = page(platform, 'ApplicationQueuePage');
const ApplicationReviewPage = page(platform, 'ApplicationReviewPage');
const EligibilityPage = page(providerStaff, 'EligibilityPage');
const ProviderApplicationReviewPage = page(providerStaff, 'ProviderApplicationReviewPage');
const SkillsCataloguePage = page(providerStaff, 'SkillsCataloguePage');
const BecomeProviderPage = page(provider, 'BecomeProviderPage');
const ProviderAvailabilityPage = page(provider, 'ProviderAvailabilityPage');
const ProviderCoveragePage = page(provider, 'ProviderCoveragePage');
const ProviderProfilePage = page(provider, 'ProviderProfilePage');
const RegisterProviderCompanyPage = page(provider, 'RegisterProviderCompanyPage');
const DashboardPage = page(() => import('@/features/workspace/dashboard-page'), 'DashboardPage');
const CataloguePage = page(catalogue, 'CataloguePage');
const CategoryPage = page(catalogue, 'CategoryPage');
const PublicLayout = page(catalogue, 'PublicLayout');
const ServicePage = page(catalogue, 'ServicePage');
const CatalogueAdminPage = page(catalogueStaff, 'CatalogueAdminPage');
const ServiceEditorPage = page(catalogueStaff, 'ServiceEditorPage');
const OrderPage = page(orderStaff, 'OrderPage');
const OrdersPage = page(orderStaff, 'OrdersPage');
const StaffRequestPage = page(orderStaff, 'StaffRequestPage');
const StaffRequestsPage = page(orderStaff, 'StaffRequestsPage');
const NewRequestPage = page(requests, 'NewRequestPage');
const RequestDetailPage = page(requests, 'RequestDetailPage');
const RequestsPage = page(requests, 'RequestsPage');
const SupportPage = page(tickets, 'SupportPage');
const NewTicketPage = page(tickets, 'NewTicketPage');
const TicketDetailPage = page(tickets, 'TicketDetailPage');
const StaffTicketsPage = page(ticketStaff, 'StaffTicketsPage');
const StaffTicketPage = page(ticketStaff, 'StaffTicketPage');
const StaffNewTicketPage = page(ticketStaff, 'StaffNewTicketPage');
const StaffNewRequestPage = page(ticketStaff, 'StaffNewRequestPage');
const JobsPage = page(jobs, 'JobsPage');
const OfferPage = page(jobs, 'OfferPage');
const JobPage = page(jobs, 'JobPage');
const CompletionPage = page(jobs, 'CompletionPage');
const DispatchPage = page(dispatch, 'DispatchPage');
const DispatchJobPage = page(dispatch, 'DispatchJobPage');
const DesignSystemPage = page(
  () => import('@/features/design-system/design-system-page'),
  'DesignSystemPage',
);

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/verify-email/pending" element={<VerifyPendingPage />} />
        <Route path="/mfa" element={<MfaPromptPage />} />
        <Route path="/mfa/setup" element={<MfaSetupPage />} />
        <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route element={<PublicLayout />}>
          <Route path="/services" element={<CataloguePage />} />
          <Route path="/services/c/:category" element={<CategoryPage />} />
          <Route path="/services/:slug" element={<ServicePage />} />
        </Route>
        <Route element={<SignedInGate />}>
          <Route index element={<DashboardPage />} />
          <Route path="/design-system" element={<DesignSystemPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/organisations/new" element={<RegisterOrganisationPage />} />
          <Route path="/organisation/application" element={<ApplicationPage />} />
          <Route path="/team" element={<MembersPage />} />
          <Route path="/team/roles" element={<RolesPage />} />
          <Route path="/team/departments" element={<DepartmentsPage />} />
          <Route path="/platform/applications" element={<ApplicationQueuePage />} />
          <Route path="/platform/applications/:id" element={<ApplicationReviewPage />} />
          <Route
            path="/platform/provider-applications/:id"
            element={<ProviderApplicationReviewPage />}
          />
          <Route path="/platform/eligibility" element={<EligibilityPage />} />
          <Route path="/platform/skills" element={<SkillsCataloguePage />} />
          <Route path="/platform/catalogue" element={<CatalogueAdminPage />} />
          <Route path="/platform/requests" element={<StaffRequestsPage />} />
          <Route path="/platform/requests/new" element={<StaffNewRequestPage />} />
          <Route path="/platform/requests/:id" element={<StaffRequestPage />} />
          <Route path="/platform/tickets" element={<StaffTicketsPage />} />
          <Route path="/platform/tickets/new" element={<StaffNewTicketPage />} />
          <Route path="/platform/tickets/:id" element={<StaffTicketPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/support/new" element={<NewTicketPage />} />
          <Route path="/support/:id" element={<TicketDetailPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/offers/:offerId" element={<OfferPage />} />
          <Route path="/jobs/:id" element={<JobPage />} />
          <Route path="/jobs/:id/complete" element={<CompletionPage />} />
          <Route path="/platform/dispatch" element={<DispatchPage />} />
          <Route path="/platform/dispatch/:id" element={<DispatchJobPage />} />
          <Route path="/platform/orders" element={<OrdersPage />} />
          <Route path="/platform/orders/:id" element={<OrderPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/requests/new" element={<NewRequestPage />} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/platform/catalogue/services/:id" element={<ServiceEditorPage />} />
          <Route path="/providers/new" element={<BecomeProviderPage />} />
          <Route path="/providers/companies/new" element={<RegisterProviderCompanyPage />} />
          <Route path="/provider" element={<ProviderProfilePage />} />
          <Route path="/provider/coverage" element={<ProviderCoveragePage />} />
          <Route path="/provider/availability" element={<ProviderAvailabilityPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
