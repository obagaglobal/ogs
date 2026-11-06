import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { SignedInGate, VerifyPendingPage } from '@/app/app-shell';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/features/auth/email-token-pages';
import { MfaPromptPage, MfaSetupPage } from '@/features/auth/mfa-pages';
import { SecurityPage } from '@/features/auth/security-page';
import { SignInPage } from '@/features/auth/sign-in-page';
import { SignUpPage } from '@/features/auth/sign-up-page';
import { ApiHealthStatus } from '@/features/system-status/api-health-status';
import {
  AcceptInvitationPage,
  DepartmentsPage,
  MembersPage,
  RolesPage,
} from '@/features/members/team-pages';
import {
  ApplicationPage,
  RegisterOrganisationPage,
} from '@/features/organisation/organisation-pages';
import { ApplicationQueuePage, ApplicationReviewPage } from '@/features/platform/platform-pages';
import {
  EligibilityPage,
  ProviderApplicationReviewPage,
  SkillsCataloguePage,
} from '@/features/platform/provider-staff-pages';
import {
  BecomeProviderPage,
  ProviderAvailabilityPage,
  ProviderCoveragePage,
  ProviderProfilePage,
  RegisterProviderCompanyPage,
} from '@/features/provider/provider-pages';
import { DashboardPage } from '@/features/workspace/dashboard-page';
import {
  CataloguePage,
  CategoryPage,
  PublicLayout,
  ServicePage,
} from '@/features/catalogue/public-pages';
import { CatalogueAdminPage, ServiceEditorPage } from '@/features/platform/catalogue-staff-pages';
import {
  OrderPage,
  OrdersPage,
  StaffRequestPage,
  StaffRequestsPage,
} from '@/features/platform/order-staff-pages';
import {
  NewRequestPage,
  RequestDetailPage,
  RequestsPage,
} from '@/features/requests/customer-request-pages';

export function AppRoutes() {
  return (
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
      <Route
        path="/status"
        element={
          <main className="mx-auto max-w-2xl px-6 py-16">
            <ApiHealthStatus />
          </main>
        }
      />
      <Route element={<PublicLayout />}>
        <Route path="/services" element={<CataloguePage />} />
        <Route path="/services/c/:category" element={<CategoryPage />} />
        <Route path="/services/:slug" element={<ServicePage />} />
      </Route>
      <Route element={<SignedInGate />}>
        <Route index element={<DashboardPage />} />
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
        <Route path="/platform/requests/:id" element={<StaffRequestPage />} />
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
