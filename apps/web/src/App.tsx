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
import { DashboardPage } from '@/features/workspace/dashboard-page';

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
      <Route
        path="/status"
        element={
          <main className="mx-auto max-w-2xl px-6 py-16">
            <ApiHealthStatus />
          </main>
        }
      />
      <Route element={<SignedInGate />}>
        <Route index element={<DashboardPage />} />
        <Route path="/security" element={<SecurityPage />} />
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
