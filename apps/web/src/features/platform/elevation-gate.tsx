import type { ElevationResponse } from '@ogs/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, Field, Notice } from '@/components/ui/form-controls';
import { useWorkspace } from '@/features/workspace/workspace-state';
import { api, describeError } from '@/lib/api';
import { currentElevation, ELEVATION_KEY } from './elevation-state';

/**
 * Cross-tenant work needs an elevation: a reason (audited with every read) and
 * a fresh authenticator code. Lasts 15 minutes, in this browser tab only.
 */
export function ElevationGate({ children }: { children: ReactNode }) {
  const { selected } = useWorkspace();
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [, rerender] = useState(0);
  const start = useMutation({
    mutationFn: async () => {
      await api('/auth/mfa/step-up', { method: 'POST', body: { code } });
      return api<ElevationResponse>('/platform/elevate', {
        method: 'POST',
        body: { reason },
        workspace: selected,
      });
    },
    onSuccess: (result) => {
      sessionStorage.setItem(
        ELEVATION_KEY,
        JSON.stringify({ id: result.elevationId, expiresAt: result.expiresAt }),
      );
      setCode('');
      rerender((n) => n + 1);
    },
  });

  if (currentElevation()) {
    return <>{children}</>;
  }
  return (
    <Card className="max-w-lg">
      <h2 className="mb-1 font-medium">Start an elevated session</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Staff work across organisations and providers means reading their data. Say why; the reason
        is recorded with every action for the next 15 minutes.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          start.mutate();
        }}
      >
        {start.isError ? <Notice tone="error">{describeError(start.error)}</Notice> : null}
        <Field
          label="Reason"
          hint="At least 10 characters, e.g. “Daily review of new applications”"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          required
        />
        <Field
          label="Authenticator code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.trim());
          }}
          required
        />
        <Button type="submit" disabled={start.isPending}>
          Start
        </Button>
      </form>
    </Card>
  );
}
