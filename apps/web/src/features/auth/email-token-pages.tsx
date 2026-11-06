import { forgotPasswordRequestSchema, newPasswordSchema } from '@ogs/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field, Notice } from '@/components/ui/form-controls';
import { api, describeError } from '@/lib/api';
import { AuthLayout } from './auth-layout';
import { tokenFromHash } from './token-from-hash';
import { useSessionChanged } from './session';

/** /verify-email#token=… — confirms the address as soon as the page opens. */
export function VerifyEmailPage() {
  const { hash } = useLocation();
  const token = tokenFromHash(hash);
  const sessionChanged = useSessionChanged();
  const verify = useMutation({
    mutationFn: async () => api('/auth/verify-email', { method: 'POST', body: { token } }),
    onSuccess: sessionChanged,
  });
  const started = useRef(false);
  useEffect(() => {
    // Once only (StrictMode mounts effects twice in development).
    if (!started.current && token !== '') {
      started.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  return (
    <AuthLayout title="Confirm your email">
      {verify.isSuccess ? (
        <Notice tone="success">Your email address is confirmed.</Notice>
      ) : verify.isError || token === '' ? (
        <Notice tone="error">
          {token === '' ? 'This link is incomplete.' : describeError(verify.error)}
        </Notice>
      ) : (
        <Notice>Confirming…</Notice>
      )}
      <p className="mt-4 text-sm">
        <Link to="/" className="underline underline-offset-4">
          Continue
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const request = useMutation({
    mutationFn: async () => api('/auth/password/forgot', { method: 'POST', body: { email } }),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = forgotPasswordRequestSchema.safeParse({ email }).success;
    setInvalid(!valid);
    if (valid) {
      request.mutate();
    }
  }

  return (
    <AuthLayout title="Reset your password">
      {request.isSuccess ? (
        <Notice tone="success">
          If an account exists for <strong>{email}</strong>, we sent it a reset link. It expires in
          30 minutes.
        </Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {request.isError ? <Notice tone="error">{describeError(request.error)}</Notice> : null}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            error={invalid ? 'Enter a valid email address' : undefined}
            required
          />
          <Button type="submit" className="w-full" disabled={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link to="/sign-in" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

/** /reset-password#token=… */
export function ResetPasswordPage() {
  const { hash } = useLocation();
  const token = tokenFromHash(hash);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const reset = useMutation({
    mutationFn: async () =>
      api('/auth/password/reset', { method: 'POST', body: { token, password } }),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = newPasswordSchema.safeParse(password);
    setError(result.success ? undefined : result.error.issues[0]?.message);
    if (result.success) {
      reset.mutate();
    }
  }

  return (
    <AuthLayout title="Choose a new password" intro="You will be signed out on every device.">
      {reset.isSuccess ? (
        <Notice tone="success">
          Your password has changed.{' '}
          <Link to="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        </Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {reset.isError ? <Notice tone="error">{describeError(reset.error)}</Notice> : null}
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            error={error}
            required
          />
          <Button type="submit" className="w-full" disabled={reset.isPending || token === ''}>
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
