import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { KitengeMotif } from '@/components/ui/kitenge-motif';
import { t } from '@/i18n';

/**
 * Centred card used by every signed-out screen (Phase 6b). The motif band sits
 * above the card, never behind text, and only on sign-in and sign-up
 * (`motif`), as the design rules allow.
 */
export function AuthLayout({
  title,
  intro,
  motif = false,
  children,
}: {
  title: string;
  intro?: string;
  motif?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-saffron px-4 py-2 font-display font-medium text-on-saffron focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('shell.skipToContent')}
      </a>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-10 sm:px-6"
      >
        <header className="space-y-3">
          <Link
            to="/services"
            className="inline-flex min-h-11 items-center gap-2 rounded-md font-display font-bold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-7 items-center justify-center rounded-sm bg-ink text-sm text-saffron"
            >
              O
            </span>
            {t('shell.brandLong')}
          </Link>
          <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
          {intro ? <p className="text-muted-foreground">{intro}</p> : null}
        </header>
        <div>
          {motif ? <KitengeMotif variant="band" height={10} className="rounded-t-md" /> : null}
          <Card
            emphasis={motif}
            className={motif ? 'space-y-4 rounded-t-none border-t-0' : 'space-y-4'}
          >
            {children}
          </Card>
        </div>
      </main>
    </div>
  );
}
