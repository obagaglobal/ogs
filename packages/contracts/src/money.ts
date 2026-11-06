/**
 * Money formatting shared by the API (emails) and the web app. Zod-free, like
 * http.ts, so the public catalogue can format prices without loading schemas.
 */

/** "KES 3,500" or "KES 3,500.50". Deterministic: no locale data involved. */
export function formatKes(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError('amountMinor must be a non-negative safe integer');
  }
  const shillings = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  const grouped = String(shillings).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents === 0 ? `KES ${grouped}` : `KES ${grouped}.${String(cents).padStart(2, '0')}`;
}
