/**
 * Shared application lifecycle (Phase 4 organisations, Phase 5 providers):
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
 *     ▲                  │  └──reject──────▶ REJECTED (final)
 *     │                  └──request changes─▶ CHANGES_REQUESTED
 *     └──── edit and resubmit ◀───────────────┘
 *
 * The database enforces that only platform staff record decisions
 * (app.protect_application_status); these rules keep the services consistent.
 */
export type ApplicationStatusValue =
  'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';

export type Decision = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

/** The applicant may edit (and submit) only in these states. */
export const EDITABLE_APPLICATION: ReadonlySet<ApplicationStatusValue> = new Set([
  'DRAFT',
  'CHANGES_REQUESTED',
]);

/** Decisions are only taken on submitted applications. */
export const DECIDABLE_APPLICATION: ApplicationStatusValue = 'SUBMITTED';
