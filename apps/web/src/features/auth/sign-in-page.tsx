import type { CurrentSessionResponse } from '@ogs/contracts';
import { loginRequestSchema } from '@ogs/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field, Notice } from '@/components/ui/form-controls';
import { api, describeError } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';
import { AuthLayout } from './auth-layout';
import { useSessionChanged } from './session';

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const sessionChanged = useSessionChanged();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);

  const signIn = useMutation({
    mutationFn: async () =>
      api<CurrentSessionResponse>('/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: async (result) => {
      await sessionChanged();
      await navigate(result.session.mfaPending ? `/mfa?next=${encodeURIComponent(next)}` : next, {
        replace: true,
      });
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = loginRequestSchema.safeParse({ email, password }).success;
    setInvalid(!valid);
    if (valid) {
      signIn.mutate();
    }
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {signIn.isError ? <Notice tone="error">{describeError(signIn.error)}</Notice> : null}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          error={invalid ? 'Enter your email address and password' : undefined}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
        />
        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="underline-offset-4 hover:underline">
            Forgot password?
          </Link>
          <Link to="/sign-up" className="underline-offset-4 hover:underline">
            Create an account
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
