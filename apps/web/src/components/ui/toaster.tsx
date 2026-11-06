import { Toaster as SonnerToaster } from 'sonner';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/theme';

const floating = 'rounded-md border border-border bg-surface text-ink shadow-[var(--shadow-float)]';

/** Mounted once in the app root; call `toast(...)` from 'sonner' anywhere. */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: cn(floating, 'font-sans text-sm'),
          title: 'font-display font-medium',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
