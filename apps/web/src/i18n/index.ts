import { en, type MessageKey } from './en';

/**
 * The one door for UI strings (Phase 6b, ADR-024). English only for now; a
 * Swahili catalogue can be added as another Partial<Record<MessageKey,string>>
 * and selected here, with English as the fallback for any missing key.
 */
export type { MessageKey };
export type Locale = 'en';

const catalogues: Record<Locale, Partial<Record<MessageKey, string>>> = { en };
let locale: Locale = 'en';

export function setLocale(next: Locale): void {
  locale = next;
}

/** Looks up `key` and fills `{name}` placeholders. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = catalogues[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * A friendly first name for "Habari, {name}". There is no name field yet, so
 * it comes from the email's local part ("grace.achieng@…" → "Grace"); null
 * when that looks like a code rather than a name.
 */
export function firstNameFromEmail(email: string): string | null {
  const local = email.split('@')[0] ?? '';
  const first = local.split(/[._+-]/)[0] ?? '';
  if (!/^[a-zA-Z]{2,}$/.test(first)) {
    return null;
  }
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** "Habari, Grace" — or plain "Habari" when no name can be derived. */
export function habari(email: string | undefined): string {
  const name = email === undefined ? null : firstNameFromEmail(email);
  return name === null ? t('greeting.habariPlain') : t('greeting.habari', { name });
}
