import { X } from 'lucide-react';
import {
  Dialog as DialogPrimitive,
  DropdownMenu as MenuPrimitive,
  Tooltip as TooltipPrimitive,
} from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Drawer as VaulDrawer } from 'vaul';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Overlays (Phase 6b): Dialog and Drawer trap focus and restore it on close
 * (Radix / vaul), Escape closes them; DropdownMenu and Tooltip are Radix;
 * toasts are sonner. Floating surfaces are the only place a shadow is used.
 */
const floating = 'rounded-md border border-border bg-surface text-ink shadow-[var(--shadow-float)]';
const scrim = 'fixed inset-0 z-40 bg-ink/40';

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={scrim} />
      <DialogPrimitive.Content
        className={cn(
          floating,
          'fixed top-1/2 left-1/2 z-50 grid max-h-[90svh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto p-6',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <DialogPrimitive.Title className="font-display text-lg font-medium">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label={t('common.close')}>
              <X aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
        {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Bottom sheet on phones, side panel from md up. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  side = 'bottom',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  side?: 'bottom' | 'left' | 'right';
}) {
  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} direction={side}>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <VaulDrawer.Content
          aria-describedby={undefined}
          className={cn(
            'fixed z-50 flex flex-col border-border bg-surface text-ink outline-none',
            side === 'bottom' && 'inset-x-0 bottom-0 max-h-[85svh] rounded-t-md border-t',
            side === 'left' && 'inset-y-0 left-0 w-[min(20rem,85vw)] border-r',
            side === 'right' && 'inset-y-0 right-0 w-[min(24rem,90vw)] border-l',
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <VaulDrawer.Title className="font-display text-base font-medium">
              {title}
            </VaulDrawer.Title>
            <VaulDrawer.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.close')}>
                <X aria-hidden="true" />
              </Button>
            </VaulDrawer.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}

export const MenuRoot = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export function MenuContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={6}
        align="end"
        className={cn(floating, 'z-50 min-w-56 p-1', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const item =
  'flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-3 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted md:min-h-9 [&_svg]:size-4 [&_svg]:shrink-0';

export function MenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn(item, className)} {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(item, 'pl-8 relative', className)} {...props}>
      <MenuPrimitive.ItemIndicator className="absolute left-3 inline-flex">
        <span className="size-2 rounded-full bg-saffron ring-1 ring-ink" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-3 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-border" />;
}

/** Tooltips supplement, never replace, a visible or accessible label. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 rounded-sm bg-ink px-2 py-1 text-xs text-paper"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
