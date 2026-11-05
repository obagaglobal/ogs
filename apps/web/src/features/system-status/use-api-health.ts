import { healthCheckResponseSchema, type HealthCheckResponse } from '@ogs/contracts';
import { useCallback, useEffect, useState } from 'react';

export const API_HEALTH_PATH = '/api/health';

export type ApiHealthState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'online'; readonly data: HealthCheckResponse }
  | { readonly kind: 'offline'; readonly reason: string };

async function fetchApiHealth(signal: AbortSignal): Promise<HealthCheckResponse> {
  const response = await fetch(API_HEALTH_PATH, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`API responded with HTTP ${String(response.status)}`);
  }
  const parsed = healthCheckResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('API returned an unexpected health payload');
  }
  return parsed.data;
}

/** Fetches the API liveness endpoint and validates it against the shared contract. */
export function useApiHealth(): { state: ApiHealthState; refresh: () => void } {
  const [state, setState] = useState<ApiHealthState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchApiHealth(controller.signal)
      .then((data) => {
        setState({ kind: 'online', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'offline',
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return () => {
      controller.abort();
    };
  }, [attempt]);

  const refresh = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, refresh };
}
