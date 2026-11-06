import type { ReactNode } from 'react';
import { Card } from '@/components/ui/form-controls';

/** Centered card used by every signed-out screen. */
export function AuthLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">OGS · ObagaGlobal Services</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      </header>
      <Card>{children}</Card>
    </main>
  );
}
