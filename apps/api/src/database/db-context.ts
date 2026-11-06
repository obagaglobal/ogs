/**
 * Who a unit of database work runs as. Turned into transaction-local PostgreSQL
 * settings (GUCs) that every RLS policy reads. See review §6.2 and ADR-010.
 *
 * The context is always passed explicitly: there is no ambient default, so
 * "forgot to set the tenant" is a compile error, not a silent cross-tenant read.
 */
export type DbContext =
  /** A signed-in user acting in their personal workspace (ADR-009: user-owned rows). */
  | { readonly kind: 'user'; readonly userId: string }
  /**
   * A user acting inside a tenant they belong to. `restricted` is true when the
   * tenant is not ACTIVE (pending, rejected, suspended): the API must then only
   * allow application-status actions (review §5 status gates).
   */
  | {
      readonly kind: 'workspace';
      readonly userId: string;
      readonly tenantId: string;
      readonly restricted: boolean;
    }
  /**
   * OGS staff reading/writing across tenants. Requires a reason; every unit of
   * work in this context is written to the audit log (review §6.3).
   */
  | {
      readonly kind: 'platform';
      readonly userId: string;
      readonly reason: string;
      readonly tenantId?: string;
    }
  /** Background work with no human actor (worker jobs, outbox dispatcher). */
  | { readonly kind: 'system'; readonly job: string; readonly tenantId?: string }
  /**
   * A visitor who is not signed in (Phase 6, P6-1). Sets NO identity at all:
   * every policy that needs a user, tenant, platform flag, job or actor kind
   * matches nothing, exactly like the "no context" state the isolation suite
   * proves. Only policies written to be context-free (the published public
   * catalogue) return rows.
   */
  | { readonly kind: 'anonymous' };

/** The transaction-local settings the RLS helper functions in schema `app` read. */
export interface DbSessionSettings {
  readonly 'app.user_id': string;
  readonly 'app.tenant_id': string;
  readonly 'app.is_platform': 'true' | 'false';
  /** '' for the anonymous context: no actor at all. */
  readonly 'app.actor_kind': 'USER' | 'SYSTEM' | '';
  /** The job name of a `system` context ('' otherwise). Identity tables require an identity.* job. */
  readonly 'app.job': string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const MAX_REASON_LENGTH = 500;

export class InvalidDbContextError extends Error {
  override readonly name = 'InvalidDbContextError';
}

function uuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidDbContextError(`${field} must be a UUID`);
  }
  return value.toLowerCase();
}

/**
 * Validates a context and maps it to GUC values. Absent values become '' which
 * the SQL helpers treat as NULL, so a missing tenant can only ever match nothing.
 */
export function toSessionSettings(ctx: DbContext): DbSessionSettings {
  switch (ctx.kind) {
    case 'user':
      return {
        'app.user_id': uuid(ctx.userId, 'userId'),
        'app.tenant_id': '',
        'app.is_platform': 'false',
        'app.actor_kind': 'USER',
        'app.job': '',
      };
    case 'workspace':
      return {
        'app.user_id': uuid(ctx.userId, 'userId'),
        'app.tenant_id': uuid(ctx.tenantId, 'tenantId'),
        'app.is_platform': 'false',
        'app.actor_kind': 'USER',
        'app.job': '',
      };
    case 'platform': {
      const reason = ctx.reason.trim();
      if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
        throw new InvalidDbContextError(
          `platform context needs a reason of 1-${String(MAX_REASON_LENGTH)} characters`,
        );
      }
      return {
        'app.user_id': uuid(ctx.userId, 'userId'),
        'app.tenant_id': ctx.tenantId === undefined ? '' : uuid(ctx.tenantId, 'tenantId'),
        'app.is_platform': 'true',
        'app.actor_kind': 'USER',
        'app.job': '',
      };
    }
    case 'anonymous':
      return {
        'app.user_id': '',
        'app.tenant_id': '',
        'app.is_platform': 'false',
        'app.actor_kind': '',
        'app.job': '',
      };
    case 'system':
      if (!JOB_PATTERN.test(ctx.job)) {
        throw new InvalidDbContextError('system context needs a dotted lower-case job name');
      }
      return {
        'app.user_id': '',
        'app.tenant_id': ctx.tenantId === undefined ? '' : uuid(ctx.tenantId, 'tenantId'),
        'app.is_platform': 'false',
        'app.actor_kind': 'SYSTEM',
        'app.job': ctx.job,
      };
  }
}
