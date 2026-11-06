/**
 * Where to go after signing in. Only paths inside this app are allowed
 * ("/x", never "//evil.example" or "https://…"): no open redirects.
 */
export function safeNext(value: string | null): string {
  return value !== null && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
