import { Injectable } from '@nestjs/common';
import {
  MembershipStatus,
  TenantDb,
  TenantKind,
  TenantStatus,
  type DbContext,
} from '../database/index.js';

/** What the client asked for (from the `X-OGS-Workspace` header in Phase 3). */
export type WorkspaceRequest = 'personal' | (string & {});

export type ProviderStatusValue = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export type ResolvedWorkspace =
  | { readonly kind: 'personal' }
  /**
   * The individual-provider capacity (Phase 5, P5-2). Runs in a `provider`
   * context (Phase 9): their provider rows are user-owned. Restricted until approved.
   */
  | {
      readonly kind: 'provider';
      readonly providerId: string;
      readonly providerStatus: ProviderStatusValue;
      readonly restricted: boolean;
    }
  | {
      readonly kind: TenantKind;
      readonly tenantId: string;
      readonly tenantName: string;
      readonly tenantStatus: TenantStatus;
      readonly membershipId: string;
      /** True when the tenant is not ACTIVE: only application-status actions are allowed. */
      readonly restricted: boolean;
    };

export type WorkspaceRefusal =
  'invalid_workspace' | 'not_a_member' | 'membership_inactive' | 'tenant_unavailable';

export type WorkspaceResolution =
  | { readonly ok: true; readonly context: DbContext; readonly workspace: ResolvedWorkspace }
  | { readonly ok: false; readonly reason: WorkspaceRefusal };

export interface WorkspaceSummary {
  readonly tenantId: string;
  readonly kind: TenantKind;
  readonly name: string;
  readonly status: TenantStatus;
  readonly restricted: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant statuses that still resolve, but only to a restricted context (review §5). */
const RESTRICTED_STATUSES: ReadonlySet<TenantStatus> = new Set([
  TenantStatus.PENDING_APPROVAL,
  TenantStatus.REJECTED,
  TenantStatus.SUSPENDED,
]);

/**
 * Turns the workspace a client *asks* for into a DbContext the server *grants*
 * (review §5). The client's value is a request, never a fact: access requires an
 * ACTIVE membership in a tenant that is not closed or deleted.
 *
 * A membership in the PLATFORM tenant resolves to an ordinary workspace context
 * for that tenant. Cross-tenant platform context is a separate, permission-gated
 * and audited elevation (DbContext kind 'platform'), never granted here.
 */
@Injectable()
export class WorkspaceContextService {
  constructor(private readonly db: TenantDb) {}

  async resolve(userId: string, requested: WorkspaceRequest): Promise<WorkspaceResolution> {
    if (requested === 'personal') {
      return { ok: true, context: { kind: 'user', userId }, workspace: { kind: 'personal' } };
    }
    if (requested === 'provider') {
      const provider = await this.individualProvider(userId);
      if (provider === null) {
        return { ok: false, reason: 'not_a_member' };
      }
      return {
        ok: true,
        // Phase 9 (P9-3): its own DbContext kind, so assigned jobs match and the
        // person's personal customer rows do not.
        context: { kind: 'provider', userId, providerId: provider.id },
        workspace: {
          kind: 'provider',
          providerId: provider.id,
          providerStatus: provider.status,
          restricted: provider.status !== 'ACTIVE',
        },
      };
    }
    if (!UUID_PATTERN.test(requested)) {
      return { ok: false, reason: 'invalid_workspace' };
    }
    const tenantId = requested.toLowerCase();

    return this.db.run({ kind: 'user', userId }, async (tx) => {
      // Two queries rather than an include: RLS hides the tenant of an ENDED
      // membership, and a required relation that RLS hides would make Prisma throw.
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { id: true, status: true },
      });
      if (membership === null) {
        return { ok: false, reason: 'not_a_member' } as const;
      }
      if (membership.status !== MembershipStatus.ACTIVE) {
        return { ok: false, reason: 'membership_inactive' } as const;
      }

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, kind: true, name: true, status: true, deletedAt: true },
      });
      if (tenant === null) {
        return { ok: false, reason: 'tenant_unavailable' } as const;
      }
      if (tenant.deletedAt !== null || tenant.status === TenantStatus.CLOSED) {
        return { ok: false, reason: 'tenant_unavailable' } as const;
      }

      const restricted = RESTRICTED_STATUSES.has(tenant.status);
      return {
        ok: true,
        context: { kind: 'workspace', userId, tenantId: tenant.id, restricted },
        workspace: {
          kind: tenant.kind,
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantStatus: tenant.status,
          membershipId: membership.id,
          restricted,
        },
      } as const;
    });
  }

  /** Tenant workspaces for the switcher (the personal workspace is always available). */
  /** The person's individual provider profile, if they have one. */
  async individualProvider(userId: string) {
    return this.db.run({ kind: 'user', userId }, async (tx) =>
      tx.provider.findUnique({
        where: { ownerUserId: userId },
        select: { id: true, status: true },
      }),
    );
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return this.db.run({ kind: 'user', userId }, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          tenant: { deletedAt: null, status: { not: TenantStatus.CLOSED } },
        },
        select: { tenant: { select: { id: true, kind: true, name: true, status: true } } },
        orderBy: { tenant: { name: 'asc' } },
      });
      return memberships.map(({ tenant }) => ({
        tenantId: tenant.id,
        kind: tenant.kind,
        name: tenant.name,
        status: tenant.status,
        restricted: RESTRICTED_STATUSES.has(tenant.status),
      }));
    });
  }
}
