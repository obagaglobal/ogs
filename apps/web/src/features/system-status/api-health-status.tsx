import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApiHealth } from './use-api-health';

export function ApiHealthStatus() {
  const { state, refresh } = useApiHealth();

  const label =
    state.kind === 'loading' ? 'Checking…' : state.kind === 'online' ? 'Online' : 'Unreachable';

  return (
    <section
      aria-labelledby="api-status-heading"
      className="rounded-lg border bg-card p-5 text-card-foreground"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="api-status-heading" className="text-sm font-semibold">
          API status
        </h2>
        <span role="status" className="inline-flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              state.kind === 'loading' && 'bg-muted-foreground',
              state.kind === 'online' && 'bg-emerald-500',
              state.kind === 'offline' && 'bg-destructive',
            )}
          />
          {label}
        </span>
      </div>

      {state.kind === 'online' && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Service</dt>
          <dd>{state.data.service}</dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd>{state.data.version}</dd>
          <dt className="text-muted-foreground">Uptime</dt>
          <dd>{state.data.uptimeSeconds}s</dd>
        </dl>
      )}

      {state.kind === 'offline' && (
        <p className="mt-4 text-sm text-muted-foreground">{state.reason}</p>
      )}

      <Button
        className="mt-4"
        variant="outline"
        size="sm"
        onClick={refresh}
        disabled={state.kind === 'loading'}
      >
        Check again
      </Button>
    </section>
  );
}
