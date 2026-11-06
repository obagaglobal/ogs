import { Injectable } from '@nestjs/common';
import type {
  SetPriceRequest,
  StaffCategory,
  StaffService,
  StaffServiceListResponse,
} from '@ogs/contracts';
import { z } from 'zod';
import {
  createCategoryRequestSchema,
  createServiceRequestSchema,
  updateCategoryRequestSchema,
  updateServiceRequestSchema,
} from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/domain-error.js';
import { Prisma, TenantDb, type Db, type DbContext } from '../database/index.js';
import { toPublicPrice } from './catalogue-public.service.js';

type CreateCategory = z.output<typeof createCategoryRequestSchema>;
type UpdateCategory = z.output<typeof updateCategoryRequestSchema>;
type CreateService = z.output<typeof createServiceRequestSchema>;
type UpdateService = z.output<typeof updateServiceRequestSchema>;
type ExperienceValue = 'UNDER_1_YEAR' | 'YEARS_1_3' | 'YEARS_3_5' | 'OVER_5_YEARS';

/** Database trigger messages → stable API codes (the triggers are the real guard). */
const TRIGGER_ERRORS: [RegExp, string][] = [
  [/slug is immutable/, 'slug_immutable'],
  [/at most two levels/, 'category_too_deep'],
  [/under an archived parent/, 'parent_archived'],
  [/with sub-categories cannot/, 'category_has_children'],
];

function mapDbError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw conflict('slug_taken');
  }
  if (error instanceof Error) {
    for (const [pattern, code] of TRIGGER_ERRORS) {
      if (pattern.test(error.message)) {
        throw conflict(code);
      }
    }
  }
  throw error;
}

const SERVICE_SELECT = {
  id: true,
  slug: true,
  name: true,
  summary: true,
  description: true,
  inclusions: true,
  exclusions: true,
  customerRequirements: true,
  typicalDuration: true,
  audience: true,
  deliveryMode: true,
  channelOgs: true,
  channelIndividual: true,
  channelCompany: true,
  status: true,
  publishedAt: true,
  retiredAt: true,
  version: true,
  updatedAt: true,
  category: { select: { slug: true, name: true, status: true } },
  prices: {
    select: {
      id: true,
      model: true,
      amountMinor: true,
      unit: true,
      minQuantity: true,
      effectiveFrom: true,
    },
    orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
  },
  skills: {
    select: { skillCode: true, minExperience: true, skill: { select: { name: true } } },
    orderBy: { skillCode: 'asc' },
  },
} as const satisfies Prisma.ServiceSelect;

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>;

/** What still blocks publishing (Phase 6 plan §2.4). */
export function missingForPublish(row: ServiceRow): string[] {
  const missing: string[] = [];
  if (row.category.status !== 'ACTIVE') missing.push('activeCategory');
  if (row.summary.trim() === '') missing.push('summary');
  if (row.description.trim() === '') missing.push('description');
  if (row.prices.length === 0) missing.push('price');
  const internalOnly = row.channelOgs && !row.channelIndividual && !row.channelCompany;
  if (!internalOnly && row.skills.length === 0) missing.push('skills');
  return missing;
}

/**
 * Staff management of the catalogue (Phase 6 plan §2.4). Every method runs in
 * the `platform` context of an elevation with platform.catalogue.manage:
 * RLS only lets platform context write, and TenantDb audits each use. Every
 * change also writes its own `catalogue.*` audit row (field names, not content).
 */
@Injectable()
export class CatalogueAdminService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ categories

  async categories(ctx: DbContext): Promise<StaffCategory[]> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx.serviceCategory.findMany({
        select: {
          id: true,
          slug: true,
          name: true,
          summary: true,
          icon: true,
          position: true,
          status: true,
          version: true,
          parent: { select: { slug: true } },
          _count: { select: { services: true } },
        },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        summary: row.summary,
        icon: row.icon,
        position: row.position,
        status: row.status,
        version: row.version,
        parentSlug: row.parent?.slug ?? null,
        serviceCount: row._count.services,
      }));
    });
  }

  async createCategory(
    ctx: DbContext,
    input: CreateCategory,
    meta: AuditRequestMeta,
  ): Promise<{ id: string }> {
    try {
      return await this.db.run(ctx, async (tx) => {
        const parentId =
          input.parentSlug === undefined || input.parentSlug === null
            ? null
            : await categoryId(tx, input.parentSlug);
        const created = await tx.serviceCategory.create({
          data: {
            slug: input.slug,
            name: input.name,
            summary: input.summary ?? null,
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.position === undefined ? {} : { position: input.position }),
            parentId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'catalogue.category_created',
          entityType: 'service_category',
          entityId: created.id,
          request: meta,
          metadata: { slug: input.slug, parentSlug: input.parentSlug ?? null },
        });
        return created;
      });
    } catch (error) {
      mapDbError(error);
    }
  }

  async updateCategory(
    ctx: DbContext,
    id: string,
    input: UpdateCategory,
    meta: AuditRequestMeta,
  ): Promise<void> {
    try {
      await this.db.run(ctx, async (tx) => {
        const parentId =
          input.parentSlug === undefined
            ? undefined
            : input.parentSlug === null
              ? null
              : await categoryId(tx, input.parentSlug);
        const changed = await tx.serviceCategory.updateMany({
          where: { id, version: input.version },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.summary === undefined ? {} : { summary: input.summary }),
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.position === undefined ? {} : { position: input.position }),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(parentId === undefined ? {} : { parentId }),
            version: { increment: 1 },
          },
        });
        await expectOne(tx, changed.count, () => tx.serviceCategory.count({ where: { id } }));
        const fields = Object.keys(input).filter((key) => key !== 'version');
        await this.audit.record(tx, {
          action:
            input.status === 'ARCHIVED'
              ? 'catalogue.category_archived'
              : input.status === 'ACTIVE'
                ? 'catalogue.category_restored'
                : 'catalogue.category_updated',
          entityType: 'service_category',
          entityId: id,
          request: meta,
          metadata: { fields },
        });
      });
    } catch (error) {
      mapDbError(error);
    }
  }

  // ------------------------------------------------------------ services

  async services(
    ctx: DbContext,
    status?: StaffService['status'],
  ): Promise<StaffServiceListResponse['services']> {
    const rows = await this.db.run(ctx, async (tx) =>
      tx.service.findMany({
        where: status === undefined ? {} : { status },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          updatedAt: true,
          category: { select: { slug: true, name: true, status: true } },
          prices: {
            select: {
              id: true,
              model: true,
              amountMinor: true,
              unit: true,
              minQuantity: true,
              effectiveFrom: true,
            },
            orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
            take: 1,
          },
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        take: 500,
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      category: row.category,
      price: staffPrice(row.prices[0]),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async service(ctx: DbContext, id: string): Promise<StaffService> {
    return this.db.run(ctx, async (tx) => this.load(tx, id));
  }

  async createService(
    ctx: DbContext,
    input: CreateService,
    meta: AuditRequestMeta,
  ): Promise<StaffService> {
    if (ctx.kind !== 'platform') {
      throw notFound();
    }
    try {
      return await this.db.run(ctx, async (tx) => {
        const { categorySlug, ...content } = input;
        const created = await tx.service.create({
          data: {
            ...withoutUndefined(content),
            categoryId: await categoryId(tx, categorySlug),
            createdBy: ctx.userId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'catalogue.service_created',
          entityType: 'service',
          entityId: created.id,
          request: meta,
          metadata: { slug: input.slug, categorySlug },
        });
        return this.load(tx, created.id);
      });
    } catch (error) {
      mapDbError(error);
    }
  }

  async updateService(
    ctx: DbContext,
    id: string,
    input: UpdateService,
    meta: AuditRequestMeta,
  ): Promise<StaffService> {
    try {
      return await this.db.run(ctx, async (tx) => {
        const { version, categorySlug, ...content } = input;
        const changed = await tx.service.updateMany({
          where: { id, version },
          data: {
            ...withoutUndefined(content),
            ...(categorySlug === undefined
              ? {}
              : { categoryId: await categoryId(tx, categorySlug) }),
            version: { increment: 1 },
          },
        });
        await expectOne(tx, changed.count, () => tx.service.count({ where: { id } }));
        await this.audit.record(tx, {
          action: 'catalogue.service_updated',
          entityType: 'service',
          entityId: id,
          request: meta,
          metadata: { fields: Object.keys(input).filter((key) => key !== 'version') },
        });
        return this.load(tx, id);
      });
    } catch (error) {
      mapDbError(error);
    }
  }

  /** A new price version (P6-3): earlier versions are never changed. */
  async setPrice(
    ctx: DbContext,
    id: string,
    input: SetPriceRequest,
    meta: AuditRequestMeta,
  ): Promise<StaffService> {
    if (ctx.kind !== 'platform') {
      throw notFound();
    }
    return this.db.run(ctx, async (tx) => {
      if ((await tx.service.count({ where: { id } })) !== 1) {
        throw notFound();
      }
      const amountMinor = input.model === 'QUOTE' ? null : BigInt(input.amountMinor);
      await tx.servicePrice.createMany({
        data: [
          {
            serviceId: id,
            model: input.model,
            amountMinor,
            unit: input.model === 'PER_UNIT' ? input.unit : null,
            minQuantity: input.model === 'PER_UNIT' ? input.minQuantity : 1,
            createdBy: ctx.userId,
          },
        ],
      });
      await this.audit.record(tx, {
        action: 'catalogue.price_set',
        entityType: 'service',
        entityId: id,
        request: meta,
        metadata: {
          model: input.model,
          amountMinor: amountMinor === null ? null : Number(amountMinor),
          ...(input.model === 'PER_UNIT'
            ? { unit: input.unit, minQuantity: input.minQuantity }
            : {}),
        },
      });
      return this.load(tx, id);
    });
  }

  async setSkills(
    ctx: DbContext,
    id: string,
    skills: readonly { code: string; minExperience: ExperienceValue }[],
    meta: AuditRequestMeta,
  ): Promise<StaffService> {
    return this.db.run(ctx, async (tx) => {
      if ((await tx.service.count({ where: { id } })) !== 1) {
        throw notFound();
      }
      const known = await tx.skill.count({
        where: { code: { in: skills.map((s) => s.code) }, active: true },
      });
      if (known !== skills.length) {
        throw conflict('skill_unknown');
      }
      await tx.serviceSkill.deleteMany({ where: { serviceId: id } });
      await tx.serviceSkill.createMany({
        data: skills.map((skill) => ({
          serviceId: id,
          skillCode: skill.code,
          minExperience: skill.minExperience,
        })),
      });
      await this.audit.record(tx, {
        action: 'catalogue.skills_set',
        entityType: 'service',
        entityId: id,
        request: meta,
        metadata: { skills: skills.map((skill) => `${skill.code}:${skill.minExperience}`) },
      });
      return this.load(tx, id);
    });
  }

  /** DRAFT → PUBLISHED → RETIRED, and RETIRED → DRAFT (P6-6). */
  async transition(
    ctx: DbContext,
    id: string,
    target: 'PUBLISHED' | 'RETIRED' | 'DRAFT',
    version: number,
    meta: AuditRequestMeta,
  ): Promise<StaffService> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.row(tx, id);
      const from: Record<typeof target, StaffService['status']> = {
        PUBLISHED: 'DRAFT',
        RETIRED: 'PUBLISHED',
        DRAFT: 'RETIRED',
      };
      if (current.status !== from[target]) {
        throw conflict('invalid_transition');
      }
      if (target === 'PUBLISHED') {
        const missing = missingForPublish(current);
        if (missing.length > 0) {
          throw conflict('service_incomplete');
        }
      }
      const now = new Date();
      const changed = await tx.service.updateMany({
        where: { id, version, status: current.status },
        data: {
          status: target,
          ...(target === 'PUBLISHED'
            ? { publishedAt: current.publishedAt ?? now, retiredAt: null }
            : {}),
          ...(target === 'RETIRED' ? { retiredAt: now } : {}),
          ...(target === 'DRAFT' ? { retiredAt: null } : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw conflict('stale_version');
      }
      await this.audit.record(tx, {
        action: `catalogue.service_${target === 'DRAFT' ? 'restored_to_draft' : target.toLowerCase()}`,
        entityType: 'service',
        entityId: id,
        request: meta,
      });
      return this.load(tx, id);
    });
  }

  // ------------------------------------------------------------ helpers

  private async row(tx: Db, id: string): Promise<ServiceRow> {
    const row = await tx.service.findUnique({ where: { id }, select: SERVICE_SELECT });
    if (row === null) {
      throw notFound();
    }
    return row;
  }

  private async load(tx: Db, id: string): Promise<StaffService> {
    const row = await this.row(tx, id);
    const history = row.prices.map((price) => staffPrice(price)).filter((price) => price !== null);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      description: row.description,
      inclusions: row.inclusions,
      exclusions: row.exclusions,
      customerRequirements: row.customerRequirements,
      typicalDuration: row.typicalDuration,
      audience: row.audience,
      deliveryMode: row.deliveryMode,
      channelOgs: row.channelOgs,
      channelIndividual: row.channelIndividual,
      channelCompany: row.channelCompany,
      status: row.status,
      category: row.category,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      retiredAt: row.retiredAt?.toISOString() ?? null,
      version: row.version,
      price: history[0] ?? null,
      priceHistory: history,
      skills: row.skills.map((skill) => ({
        code: skill.skillCode,
        name: skill.skill.name,
        minExperience: skill.minExperience,
      })),
      missing: missingForPublish(row),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function staffPrice(
  price:
    | {
        id: string;
        model: StaffService['priceHistory'][number]['model'];
        amountMinor: bigint | null;
        unit: StaffService['priceHistory'][number]['unit'];
        minQuantity: number;
        effectiveFrom: Date;
      }
    | undefined,
): StaffService['price'] {
  if (price === undefined) {
    return null;
  }
  const dto = toPublicPrice({
    model: price.model,
    amount_minor: price.amountMinor,
    unit: price.unit,
    min_quantity: price.minQuantity,
  });
  return dto === null
    ? null
    : { ...dto, id: price.id, effectiveFrom: price.effectiveFrom.toISOString() };
}

async function categoryId(tx: Db, slug: string): Promise<string> {
  const category = await tx.serviceCategory.findUnique({ where: { slug }, select: { id: true } });
  if (category === null) {
    throw conflict('category_unknown');
  }
  return category.id;
}

/** 1 row changed, or: the row is gone (404) or someone else changed it first (409). */
async function expectOne(_tx: Db, count: number, exists: () => Promise<number>): Promise<void> {
  if (count === 1) {
    return;
  }
  throw (await exists()) === 0 ? notFound() : conflict('stale_version');
}

function withoutUndefined<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
