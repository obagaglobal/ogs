import { Injectable } from '@nestjs/common';
import type { RegionListResponse, SkillListResponse } from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/domain-error.js';
import { Prisma, TenantDb, type DbContext } from '../database/index.js';

/**
 * Platform-owned taxonomies (Phase 5 plan §2.3, P5-3): skills and regions.
 * Anyone signed in reads them; only staff with platform.catalogue.manage
 * change skills (regions are seeded reference data). A deactivated skill
 * disappears from pickers but stays on the profiles that already have it.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async skills(ctx: DbContext, includeInactive: boolean): Promise<SkillListResponse> {
    const skills = await this.db.run(ctx, async (tx) =>
      tx.skill.findMany({
        where: includeInactive ? {} : { active: true },
        select: { code: true, name: true, category: true, active: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
    );
    return { skills };
  }

  async regions(ctx: DbContext): Promise<RegionListResponse> {
    const regions = await this.db.run(ctx, async (tx) =>
      tx.region.findMany({
        where: { active: true },
        select: { code: true, name: true, country: true },
        orderBy: [{ country: 'asc' }, { name: 'asc' }],
      }),
    );
    return { regions };
  }

  async createSkill(
    ctx: DbContext,
    input: { code: string; name: string; category: string },
    meta: AuditRequestMeta,
  ): Promise<void> {
    try {
      await this.db.run(ctx, async (tx) => {
        await tx.skill.createMany({ data: [input] });
        await this.audit.record(tx, {
          action: 'catalogue.skill_created',
          entityType: 'skill',
          entityId: input.code,
          request: meta,
          metadata: { name: input.name, category: input.category },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('skill_exists');
      }
      throw error;
    }
  }

  async updateSkill(
    ctx: DbContext,
    code: string,
    change: {
      name?: string | undefined;
      category?: string | undefined;
      active?: boolean | undefined;
    },
    meta: AuditRequestMeta,
  ): Promise<void> {
    await this.db.run(ctx, async (tx) => {
      const data = Object.fromEntries(
        Object.entries(change).filter(([, value]) => value !== undefined),
      );
      const changed = await tx.skill.updateMany({ where: { code }, data });
      if (changed.count !== 1) {
        throw notFound();
      }
      await this.audit.record(tx, {
        action: 'catalogue.skill_updated',
        entityType: 'skill',
        entityId: code,
        request: meta,
        metadata: data,
      });
    });
  }
}
