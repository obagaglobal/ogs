import { estimateStrength } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

const BAR = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

/** Advisory strength bar under a new-password field (F-1). Announced politely. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (password === '') {
    return null;
  }
  const { score, label, hint } = estimateStrength(password);
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'h-1.5 flex-1 rounded-full bg-muted',
              index < Math.max(score, 1) && BAR[score],
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Strength: <span className="font-medium text-foreground">{label}</span>
        {hint ? ` — ${hint}` : ''}
      </p>
    </div>
  );
}
