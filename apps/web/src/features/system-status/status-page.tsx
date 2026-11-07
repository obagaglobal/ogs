import { ApiHealthStatus } from './api-health-status';

/** /status: the API health check, outside the signed-in shell. */
export function StatusPage() {
  return (
    <main id="main" className="mx-auto min-h-svh max-w-2xl bg-paper px-6 py-16 text-ink">
      <ApiHealthStatus />
    </main>
  );
}
