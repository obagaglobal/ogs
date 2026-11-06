import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  elevateRequestSchema,
  type ElevationResponse,
  type PlatformTenantListResponse,
} from '@ogs/contracts';
import {
  Auth,
  Authenticated,
  Ctx,
  RequireElevation,
  RequirePermission,
  RequireRecentMfa,
} from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantDb, type DbContext } from '../database/index.js';
import { SessionStore } from '../sessions/session.store.js';

/** How long an elevation lasts (Phase 3 plan §3.2). */
export const ELEVATION_MINUTES = 15;

/**
 * /api/v1/platform — OGS staff acting across tenants (review §6.3, plan §3.2).
 *
 * Elevation is explicit and short: a PLATFORM member with
 * `platform.cross_tenant_access`, who stepped up with MFA in the last 15
 * minutes, states a reason. The session then carries an elevation for 15
 * minutes; requests naming it in X-OGS-Elevation run in a `platform` context,
 * and every unit of work in that context is written to the audit log.
 */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly sessions: SessionStore,
    private readonly audit: AuditService,
    private readonly db: TenantDb,
  ) {}

  @Post('elevate')
  @RequirePermission('platform.cross_tenant_access')
  @RequireRecentMfa(15)
  @Header('Cache-Control', 'no-store')
  async elevate(
    @Body() body: unknown,
    @Auth() auth: AccessState,
    @Ctx() ctx: DbContext,
  ): Promise<ElevationResponse> {
    const { reason, tenantId } = parseBody(elevateRequestSchema, body);
    const elevation = {
      id: randomUUID(),
      reason,
      tenantId: tenantId ?? null,
      expiresAt: Date.now() + ELEVATION_MINUTES * 60_000,
    };
    await this.sessions.update(auth.sessionToken, { elevation });
    // Recorded in the PLATFORM workspace, against the staff member.
    await this.db.run(ctx, async (tx) =>
      this.audit.record(tx, {
        action: 'platform.elevation_started',
        tenantId: ctx.kind === 'workspace' ? ctx.tenantId : null,
        entityType: 'elevation',
        entityId: elevation.id,
        reason,
        request: auth.meta,
        metadata: { scopeTenantId: elevation.tenantId, minutes: ELEVATION_MINUTES },
      }),
    );
    return {
      elevationId: elevation.id,
      expiresAt: new Date(elevation.expiresAt).toISOString(),
      tenantId: elevation.tenantId,
    };
  }

  @Post('elevation/end')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(@Auth() auth: AccessState): Promise<void> {
    await this.sessions.update(auth.sessionToken, { elevation: null });
  }

  /** Every tenant on the platform (or the one the elevation is scoped to). */
  @Get('tenants')
  @RequireElevation('platform.tenant.review')
  @Header('Cache-Control', 'no-store')
  async tenants(@Ctx() ctx: DbContext): Promise<PlatformTenantListResponse> {
    const rows = await this.db.run(ctx, async (tx) =>
      tx.tenant.findMany({
        where: ctx.kind === 'platform' && ctx.tenantId !== undefined ? { id: ctx.tenantId } : {},
        select: { id: true, kind: true, name: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return {
      tenants: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    };
  }
}
