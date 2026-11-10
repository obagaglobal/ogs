import { resetRateLimits } from './rate-limits';

/** Before each run, clear the local rate-limit counters (see rate-limits.ts). */
export default async function globalSetup(): Promise<void> {
  await resetRateLimits();
}
