import { PASSWORD_MIN_LENGTH, registerRequestSchema } from '@ogs/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field, Notice } from '@/components/ui/form-controls';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { api, describeError } from '@/lib/api';
import { AuthLayout } from './auth-layout';

export function SignUpPage() {
  // An invitation link passes the invited address, which must not change.
  const [params] = useSearchParams();
  const invitedEmail = params.get('email');
  const [email, setEmail] = useState(invitedEmail ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const register = useMutation({
    mutationFn: async () => api('/auth/register', { method: 'POST', body: { email, password } }),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = registerRequestSchema.safeParse({ email, password });
    if (!result.success) {
      setErrors(
        Object.fromEntries(
          result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    register.mutate();
  }

  if (register.isSuccess) {
    return (
      <AuthLayout title="Check your email">
        <Notice tone="success">
          We sent a confirmation link to <strong>{email}</strong>. Open it to activate your account.
        </Notice>
        <p className="mt-4 text-sm">
          <Link to="/sign-in" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" intro="One account for every way you use OGS.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {register.isError ? <Notice tone="error">{describeError(register.error)}</Notice> : null}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          error={errors['email']}
          readOnly={invitedEmail !== null}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters. A few unrelated words work well.`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          error={errors['password']}
          required
        />
        <PasswordStrengthMeter password={password} />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-sm">
          Already have an account?{' '}
          <Link to="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
