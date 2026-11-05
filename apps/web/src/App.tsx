import { ApiHealthStatus } from '@/features/system-status/api-health-status';

export function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">ObagaGlobal</p>
        <h1 className="text-3xl font-semibold tracking-tight">OGS – ObagaGlobal Services</h1>
        <p className="text-muted-foreground">
          Development foundation. Platform features have not been built yet.
        </p>
      </header>
      <ApiHealthStatus />
    </main>
  );
}
