/** Reads `#token=...` from the URL fragment (never sent to servers or logs). */
export function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}
