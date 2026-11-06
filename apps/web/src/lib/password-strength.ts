/**
 * Advisory password strength (ASVS follow-up F-1, decision P4-7). The SERVER
 * decides what is acceptable (length, breached list, context words); this only
 * nudges people towards long, unpredictable passphrases while they type.
 *
 * Estimate: log2 of a brute-force search space, then penalties for patterns
 * attackers try first (common words, keyboard runs, sequences, repeats).
 */

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export interface Strength {
  readonly score: StrengthScore;
  readonly label: 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  readonly hint: string | undefined;
  readonly bits: number;
}

const COMMON_FRAGMENTS = [
  'password',
  'passw0rd',
  'qwerty',
  'asdf',
  'zxcv',
  'letmein',
  'welcome',
  'admin',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'sunshine',
  'princess',
  'abc123',
  '123456',
  '654321',
  '111111',
  'kenya',
  'nairobi',
  'mombasa',
  'obaga',
  'ogs',
];
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];
const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

function alphabetSize(password: string): number {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/\d/.test(password)) size += 10;
  if (/[^A-Za-z0-9\s]/.test(password)) size += 33;
  if (/\s/.test(password)) size += 1;
  if (/[^ -~]/u.test(password)) size += 100;
  return Math.max(size, 1);
}

/** Characters that continue an ascending/descending or keyboard run. */
function runLength(lower: string): number {
  let longest = 1;
  let current = 1;
  for (let i = 1; i < lower.length; i += 1) {
    const prev = lower.charCodeAt(i - 1);
    const next = lower.charCodeAt(i);
    const pair = lower.slice(i - 1, i + 1);
    const sequential = Math.abs(next - prev) === 1;
    const keyboard = KEYBOARD_ROWS.some(
      (row) => row.includes(pair) || Array.from(row).reverse().join('').includes(pair),
    );
    current = sequential || keyboard || next === prev ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function estimateStrength(password: string): Strength {
  const chars = Array.from(password);
  if (chars.length === 0) {
    return { score: 0, label: LABELS[0], hint: undefined, bits: 0 };
  }
  const lower = password.toLowerCase();
  const unique = new Set(chars).size;
  let bits = chars.length * Math.log2(alphabetSize(password));

  // Few distinct characters ("aaaaaaaaaaaa", "abababab…") are far easier to guess.
  bits *= Math.min(1, unique / Math.min(chars.length, 10));

  let hint: string | undefined;
  // A repeated chunk ("Kenya2026Kenya2026") adds almost nothing over one copy.
  const repeated = /(.{3,})\1/u.exec(lower);
  if (repeated?.[1] !== undefined) {
    bits *= 1 - (repeated[1].length * 0.9) / chars.length;
    hint = 'Avoid repeating the same part twice.';
  }
  const fragment = COMMON_FRAGMENTS.find((word) => lower.includes(word));
  if (fragment !== undefined) {
    bits -= fragment.length * 4;
    hint ??= 'Avoid common words and names like “' + fragment + '”.';
  }
  const run = runLength(lower);
  if (run >= 4) {
    bits -= run * 3;
    hint ??= 'Avoid sequences and keyboard patterns like “abcd” or “qwer”.';
  }
  if (chars.length < 12) {
    hint ??= 'Use at least 12 characters. A few unrelated words work well.';
  }
  bits = Math.max(0, bits);
  const score: StrengthScore =
    chars.length < 12 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (score >= 3) {
    hint = undefined;
  } else {
    hint ??= 'Make it longer: add another unrelated word.';
  }
  return { score, label: LABELS[score], hint, bits: Math.round(bits) };
}
