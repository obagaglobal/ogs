import { Command } from 'cmdk';
import { CalendarDays, Check, ChevronsUpDown } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * Combobox (cmdk in a Radix popover) and DatePicker (react-day-picker in a
 * popover), Phase 6b. Both triggers are buttons that look like inputs and
 * accept the FormField ids. Dates are shown in en-KE format.
 */
const trigger =
  'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-control-border bg-surface px-3 py-2 text-left text-base text-ink motion-fast transition-colors hover:border-ink aria-invalid:border-danger md:min-h-10 md:text-sm';
const popover =
  'z-50 rounded-md border border-border bg-surface text-ink shadow-[var(--shadow-float)]';

export interface Option {
  value: string;
  label: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  searchLabel,
  id,
  ...aria
}: {
  options: readonly Option[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  searchLabel: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          id={id}
          className={trigger}
          {...aria}
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(popover, 'w-[var(--radix-popover-trigger-width)] min-w-56 p-1')}
        >
          <Command label={searchLabel}>
            <Command.Input
              placeholder={searchLabel}
              className="mb-1 min-h-10 w-full rounded-sm border border-control-border bg-surface px-3 text-sm"
            />
            <Command.List className="max-h-64 overflow-y-auto">
              <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">
                {t('common.noMatches')}
              </Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm data-[selected=true]:bg-surface-muted md:min-h-9"
                >
                  <Check
                    aria-hidden="true"
                    className={cn('size-4', option.value === value ? 'opacity-100' : 'opacity-0')}
                  />
                  {option.label}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

const dateFormat = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeZone: 'Africa/Nairobi',
});

export function DatePicker({
  value,
  onChange,
  disabledBefore,
  id,
  ...aria
}: {
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
  disabledBefore?: Date;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" id={id} className={trigger} {...aria}>
          <span className={cn('tabular', !value && 'font-sans text-muted-foreground')}>
            {value ? dateFormat.format(value) : t('common.chooseDate')}
          </span>
          <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(popover, 'ogs-day-picker p-3')}
        >
          <DayPicker
            mode="single"
            selected={value}
            onSelect={(day) => {
              onChange(day);
              setOpen(false);
            }}
            weekStartsOn={1}
            {...(disabledBefore ? { disabled: { before: disabledBefore } } : {})}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
