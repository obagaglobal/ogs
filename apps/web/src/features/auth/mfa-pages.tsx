import type { MfaSetupResponse, RecoveryCodesResponse } from '@ogs/contracts';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field, Notice } from '@/components/ui/form-controls';
import { api, describeError } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';
import { AuthLayout } from './auth-layout';
import { useSessionChanged } from './session';

/** Second step of sign-in: a 6-digit code, or a recovery code. */
export function MfaPromptPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const sessionChanged = useSessionChanged();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');

  const verify = useMutation({
    mutationFn: async () =>
      api('/auth/mfa/verify', {
        method: 'POST',
        body: useRecovery ? { recoveryCode: value } : { code: value },
      }),
    onSuccess: async () => {
      await sessionChanged();
      await navigate(next, { replace: true });
    },
  });

  return (
    <AuthLayout
      title="Two-step verification"
      intro={
        useRecovery
          ? 'Enter one of your recovery codes.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          verify.mutate();
        }}
      >
        {verify.isError ? <Notice tone="error">{describeError(verify.error)}</Notice> : null}
        <Field
          label={useRecovery ? 'Recovery code' : 'Authentication code'}
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          value={value}
          onChange={(event) => {
            setValue(event.target.value.trim());
          }}
          required
        />
        <Button type="submit" className="w-full" disabled={verify.isPending}>
          Verify
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setValue('');
          }}
        >
          {useRecovery ? 'Use the authenticator app instead' : 'Use a recovery code instead'}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Enrolment: scan the QR code, confirm with a first code, save the recovery codes. */
export function MfaSetupPage() {
  const navigate = useNavigate();
  const sessionChanged = useSessionChanged();
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();

  const setup = useMutation({
    mutationFn: async () => api<MfaSetupResponse>('/auth/mfa/totp/setup', { method: 'POST' }),
  });
  const confirm = useMutation({
    mutationFn: async () =>
      api<RecoveryCodesResponse>('/auth/mfa/totp/confirm', { method: 'POST', body: { code } }),
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
    },
  });

  // Exactly one setup request: StrictMode (and remounts) run effects twice, and two
  // racing requests could leave the QR code showing the secret the server replaced.
  const started = useRef(false);
  const { mutate: startSetup } = setup;
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      startSetup();
    }
  }, [startSetup]);
  useEffect(() => {
    if (setup.data) {
      void QRCode.toDataURL(setup.data.otpauthUri, { margin: 1, width: 192 }).then(setQr);
    }
  }, [setup.data]);

  if (recoveryCodes) {
    return (
      <AuthLayout
        title="Save your recovery codes"
        intro="Each code works once if you lose your phone. Store them somewhere safe: they are not shown again."
      >
        <ul className="grid grid-cols-2 gap-2 tabular text-sm" aria-label="Recovery codes">
          {recoveryCodes.map((recovery) => (
            <li key={recovery} className="rounded border px-2 py-1">
              {recovery}
            </li>
          ))}
        </ul>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            void sessionChanged().then(() => navigate('/', { replace: true }));
          }}
        >
          I have saved them
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set up two-step verification"
      intro="Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…)."
    >
      <div className="space-y-4">
        {setup.isError ? <Notice tone="error">{describeError(setup.error)}</Notice> : null}
        {qr ? (
          <img src={qr} alt="QR code for your authenticator app" className="mx-auto size-48" />
        ) : null}
        {setup.data ? (
          <p className="text-center text-xs text-muted-foreground">
            Can’t scan? Enter this key:{' '}
            <code className="break-all tabular">{setup.data.secret}</code>
          </p>
        ) : null}
        <form
          className="space-y-4"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            confirm.mutate();
          }}
        >
          {confirm.isError ? <Notice tone="error">{describeError(confirm.error)}</Notice> : null}
          <Field
            label="6-digit code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.trim());
            }}
            required
          />
          <Button type="submit" className="w-full" disabled={confirm.isPending || !setup.data}>
            Turn on two-step verification
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
