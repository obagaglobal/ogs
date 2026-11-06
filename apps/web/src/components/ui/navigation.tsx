import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** Tabs (Radix): arrow keys move between tabs; the active tab has a saffron underline. */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('mb-4 flex gap-1 overflow-x-auto border-b border-border', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px min-h-11 cursor-pointer whitespace-nowrap border-b-2 border-transparent px-3 font-display text-sm font-medium text-muted-foreground motion-fast transition-colors hover:text-ink data-[state=active]:border-saffron data-[state=active]:text-ink md:min-h-9',
        className,
      )}
      {...props}
    />
  );
}

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
        {items.map((crumb, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1">
              {crumb.to && !last ? (
                <Link to={crumb.to} className="underline-offset-4 hover:text-ink hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-ink')}>
                  {crumb.label}
                </span>
              )}
              {last ? null : <ChevronRight aria-hidden="true" className="size-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        <ChevronLeft aria-hidden="true" />
        {t('common.previous')}
      </Button>
      <span className="tabular text-sm text-muted-foreground" aria-live="polite">
        {t('common.page', { page: String(page), pages: String(pages) })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        {t('common.next')}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}

/** Horizontal steps (wizards). `current` is zero-based. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-x-6 gap-y-2">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className={cn(
                'tabular inline-flex size-6 items-center justify-center rounded-full border text-xs',
                done && 'border-ink bg-ink text-paper',
                active && 'border-ink bg-saffron text-on-saffron',
                !done && !active && 'border-control-border text-muted-foreground',
              )}
            >
              {done ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
            </span>
            <span className={cn(active ? 'font-medium text-ink' : 'text-muted-foreground')}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface TimelineEntry {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
}

/** Vertical history (request events, audit). The newest entry is highlighted. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {entries.map((entry, index) => (
        <li key={entry.key} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-1.5 -left-[1.6875rem] size-2.5 rounded-full border border-ink',
              index === entries.length - 1 ? 'bg-saffron' : 'bg-surface',
            )}
          />
          <p className="text-sm font-medium text-ink">{entry.title}</p>
          {entry.meta ? <p className="text-xs text-muted-foreground">{entry.meta}</p> : null}
          {entry.body ? <div className="mt-1 text-sm">{entry.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}
