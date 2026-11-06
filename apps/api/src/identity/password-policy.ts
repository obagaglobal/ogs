import { readFileSync } from 'node:fs';

/** Words that make a password guessable in the OGS context (ASVS 2.1.7 context words). */
const CONTEXT_WORDS = ['obagaglobal', 'obaga global', 'ogsplatform'];

export type PasswordRejection = 'breached' | 'contains_email' | 'contains_service_name';

/**
 * Server-side password checks on top of the length rules in @ogs/contracts
 * (decision P3-4: offline list, no external call on the login path).
 */
export class PasswordPolicy {
  private readonly breached: ReadonlySet<string>;

  constructor(list: Iterable<string> = loadBundledList()) {
    this.breached = new Set([...list].map((entry) => entry.toLowerCase()));
  }

  /** Returns why the password is unacceptable, or undefined when it is fine. */
  check(password: string, email: string): PasswordRejection | undefined {
    const lower = password.normalize('NFKC').toLowerCase();
    if (this.breached.has(lower)) {
      return 'breached';
    }
    const localPart = email.split('@')[0]?.toLowerCase() ?? '';
    if (localPart.length >= 4 && lower.includes(localPart)) {
      return 'contains_email';
    }
    if (CONTEXT_WORDS.some((word) => lower.includes(word))) {
      return 'contains_service_name';
    }
    return undefined;
  }

  get size(): number {
    return this.breached.size;
  }
}

function loadBundledList(): string[] {
  // Copied next to the compiled code by the Nest CLI (nest-cli.json "assets").
  const text = readFileSync(new URL('./data/breached-passwords.txt', import.meta.url), 'utf8');
  return text.split('\n').filter((line) => line.length > 0);
}
