import type { AccessState } from '../access/access.types.js';
import { forbiddenRule } from '../common/domain-error.js';
import { TenantKind, type DbContext } from '../database/index.js';

/** An elevated staff member: the platform context and their platform permissions. */
export interface JobStaff {
  readonly ctx: DbContext;
  readonly userId: string;
  readonly permissions: ReadonlySet<string>;
}

export function staffOf(auth: AccessState): JobStaff {
  const workspace = auth.workspace;
  if (workspace === undefined) {
    throw new Error('elevated route without a workspace');
  }
  return { ctx: workspace.context, userId: auth.user.id, permissions: workspace.permissions };
}

/**
 * Who works jobs (Phase 9 plan §2.6, P9-3):
 *  - the Provider workspace → an individual provider (implicitly holding the
 *    assignee permissions: there is no membership);
 *  - a PROVIDER_COMPANY workspace → the company, with the member's permissions
 *    (assignment.respond for offers, ticket.assign to dispatch within the
 *    company, ticket.update_progress to do the work);
 *  - the PLATFORM workspace, NOT elevated → an internal OGS technician, who sees
 *    only their own jobs.
 * Personal and organisation workspaces are customers, never assignees.
 */
export interface JobAssignee {
  readonly ctx: DbContext;
  readonly userId: string;
  readonly kind: 'INTERNAL' | 'INDIVIDUAL' | 'COMPANY';
  readonly providerId?: string;
  readonly tenantId?: string;
  readonly permissions: ReadonlySet<string>;
  /** Scopes idempotency keys to the workspace. */
  readonly scope: string;
}

const INDIVIDUAL_PERMISSIONS: ReadonlySet<string> = new Set([
  'ticket.read',
  'assignment.respond',
  'ticket.update_progress',
]);

export function assigneeOf(auth: AccessState): JobAssignee {
  const workspace = auth.workspace;
  if (workspace === undefined) {
    throw forbiddenRule('workspace_forbidden');
  }
  const resolved = workspace.resolved;
  if (resolved.kind === 'provider') {
    if (resolved.restricted) {
      throw forbiddenRule('workspace_restricted');
    }
    return {
      ctx: workspace.context,
      userId: auth.user.id,
      kind: 'INDIVIDUAL',
      providerId: resolved.providerId,
      permissions: INDIVIDUAL_PERMISSIONS,
      scope: `provider:${resolved.providerId}`,
    };
  }
  if (resolved.kind === TenantKind.PROVIDER_COMPANY || resolved.kind === TenantKind.PLATFORM) {
    const permissions = workspace.permissions;
    const any = ['ticket.read', 'assignment.respond', 'ticket.update_progress', 'ticket.assign'];
    if (!any.some((code) => permissions.has(code))) {
      throw forbiddenRule('permission_denied');
    }
    return {
      ctx: workspace.context,
      userId: auth.user.id,
      kind: resolved.kind === TenantKind.PLATFORM ? 'INTERNAL' : 'COMPANY',
      tenantId: resolved.tenantId,
      permissions,
      scope: resolved.tenantId,
    };
  }
  throw forbiddenRule('not_an_assignee_workspace');
}

export function requirePermission(actor: { permissions: ReadonlySet<string> }, code: string): void {
  if (!actor.permissions.has(code)) {
    throw forbiddenRule('permission_denied');
  }
}
