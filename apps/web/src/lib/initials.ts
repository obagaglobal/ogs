/** Up to two initials from a name or e-mail address ("Wanjiru Kamau" → "WK"). */
export function initialsOf(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter((part) => /^[a-zA-Z]/.test(part));
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
