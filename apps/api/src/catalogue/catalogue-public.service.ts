import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CATALOGUE_PAGE_SIZE,
  priceLabel,
  withIndicativeVat,
  type CatalogueSearchQuery,
  type PriceModel,
  type PriceUnit,
  type PublicCategory,
  type PublicCategoryResponse,
  type PublicPrice,
  type PublicServiceDetail,
  type PublicServiceListResponse,
  type PublicServiceSummary,
} from '@ogs/contracts';
import { badRequest, notFound } from '../common/domain-error.js';
import { Prisma, TenantDb, type DbContext } from '../database/index.js';

/** Every public read runs with no identity at all (P6-1): RLS shows only the published catalogue. */
const ANONYMOUS: DbContext = { kind: 'anonymous' };

interface PriceRow {
  model: PriceModel;
  amount_minor: bigint | null;
  unit: PriceUnit | null;
  min_quantity: number;
}

/** Shared by the public and staff views: the one place a price row becomes a DTO. */
export function toPublicPrice(row: PriceRow | null): PublicPrice | null {
  if (row === null) {
    return null;
  }
  const amountMinor = row.amount_minor === null ? null : Number(row.amount_minor);
  const price = { model: row.model, amountMinor, unit: row.unit, minQuantity: row.min_quantity };
  return {
    ...price,
    currency: 'KES',
    label: priceLabel(price),
    vatInclusiveMinor: amountMinor === null ? null : withIndicativeVat(amountMinor),
  };
}

interface Cursor {
  /** Primary sort key: -score (search) or category order (browse). */
  k1: string;
  /** Secondary sort key: '' (search) or the service name (browse). */
  k2: string;
  id: string;
  /** Hash of the filters the cursor belongs to. */
  h: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface SearchRow extends PriceRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  audience: PublicServiceSummary['audience'];
  delivery_mode: PublicServiceSummary['deliveryMode'];
  category_slug: string;
  category_name: string;
  has_price: boolean;
  k1: bigint;
  k2: string;
}

/**
 * The public catalogue (Phase 6 plan §2.2). Read-only, anonymous, and shaped
 * by separate public DTOs that never carry internal fields (`.strict()` schemas
 * in the contracts).
 */
@Injectable()
export class CataloguePublicService {
  constructor(private readonly db: TenantDb) {}

  async categories(): Promise<PublicCategory[]> {
    const rows = await this.categoryRows();
    const roots = rows.filter((row) => row.parent_id === null);
    return roots.map((root) => this.toCategory(root, rows));
  }

  async category(slug: string): Promise<PublicCategoryResponse> {
    const rows = await this.categoryRows();
    const row = rows.find((candidate) => candidate.slug === slug);
    if (row === undefined) {
      throw notFound();
    }
    const parent = rows.find((candidate) => candidate.id === row.parent_id) ?? null;
    return {
      category: this.toCategory(row, rows),
      parent: parent === null ? null : { slug: parent.slug, name: parent.name },
    };
  }

  async search(query: CatalogueSearchQuery): Promise<PublicServiceListResponse> {
    const limit = query.limit ?? CATALOGUE_PAGE_SIZE;
    const text = query.q?.trim() ?? '';
    const hash = filterHash(query);
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor, hash);
    const priceFiltered = query.minPrice !== undefined || query.maxPrice !== undefined;

    const rows = await this.db.run(ANONYMOUS, async (tx) =>
      tx.$queryRaw<SearchRow[]>(Prisma.sql`
        WITH params AS (
          SELECT websearch_to_tsquery('english', ${text}) || websearch_to_tsquery('simple', ${text}) AS tsq
        ),
        candidates AS (
          SELECT s.id, s.slug, s.name, s.summary, s.audience, s.delivery_mode,
                 c.slug AS category_slug, c.name AS category_name,
                 price.model, price.amount_minor, price.unit, price.min_quantity,
                 price.model IS NOT NULL AS has_price,
                 CASE WHEN ${text} <> '' AND numnode(params.tsq) > 0
                      THEN -round(ts_rank(s.search_vector, params.tsq) * 1000000)::bigint
                      ELSE (coalesce(pc.position, c.position)::bigint * 100000
                            + CASE WHEN pc.id IS NULL THEN 0 ELSE c.position + 1 END)
                 END AS k1,
                 CASE WHEN ${text} <> '' AND numnode(params.tsq) > 0 THEN '' ELSE s.name END AS k2
            FROM service s
            CROSS JOIN params
            JOIN service_category c ON c.id = s.category_id
            LEFT JOIN service_category pc ON pc.id = c.parent_id
            LEFT JOIN LATERAL (
              SELECT p.model, p.amount_minor, p.unit, p.min_quantity
                FROM service_price p
               WHERE p.service_id = s.id
               ORDER BY p.effective_from DESC, p.id DESC
               LIMIT 1
            ) price ON true
           WHERE s.status = 'PUBLISHED'
             AND c.status = 'ACTIVE'
             AND (${text} = '' OR numnode(params.tsq) = 0 OR s.search_vector @@ params.tsq)
             ${query.category === undefined ? Prisma.empty : Prisma.sql`AND (c.slug = ${query.category} OR pc.slug = ${query.category})`}
             ${query.audience === undefined ? Prisma.empty : Prisma.sql`AND s.audience = ${query.audience}::"ServiceAudience"`}
             ${query.delivery === undefined ? Prisma.empty : Prisma.sql`AND s.delivery_mode = ${query.delivery}::"DeliveryMode"`}
             ${query.model === undefined ? Prisma.empty : Prisma.sql`AND price.model = ${query.model}::"PriceModel"`}
             ${priceFiltered ? Prisma.sql`AND price.model IN ('FIXED', 'PER_UNIT')` : Prisma.empty}
             ${query.minPrice === undefined ? Prisma.empty : Prisma.sql`AND price.amount_minor >= ${query.minPrice}`}
             ${query.maxPrice === undefined ? Prisma.empty : Prisma.sql`AND price.amount_minor <= ${query.maxPrice}`}
        )
        SELECT * FROM candidates
         ${cursor === null ? Prisma.empty : Prisma.sql`WHERE (k1, k2, id) > (${BigInt(cursor.k1)}, ${cursor.k2}, ${cursor.id}::uuid)`}
         ORDER BY k1, k2, id
         LIMIT ${limit + 1}
      `),
    );

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      services: page.map((row) => this.toSummary(row)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ k1: String(last.k1), k2: last.k2, id: last.id, h: hash })
          : null,
    };
  }

  async service(slug: string): Promise<PublicServiceDetail> {
    const row = await this.db.run(ANONYMOUS, async (tx) =>
      tx.service.findFirst({
        where: { slug, status: 'PUBLISHED', category: { status: 'ACTIVE' } },
        select: {
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
          category: {
            select: { slug: true, name: true, parent: { select: { slug: true, name: true } } },
          },
          prices: {
            select: { model: true, amountMinor: true, unit: true, minQuantity: true },
            orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
            take: 1,
          },
        },
      }),
    );
    if (row === null) {
      throw notFound();
    }
    const current = row.prices[0];
    return {
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      category: { slug: row.category.slug, name: row.category.name },
      parentCategory: row.category.parent,
      audience: row.audience,
      deliveryMode: row.deliveryMode,
      price:
        current === undefined
          ? null
          : toPublicPrice({
              model: current.model,
              amount_minor: current.amountMinor,
              unit: current.unit,
              min_quantity: current.minQuantity,
            }),
      description: row.description,
      inclusions: row.inclusions,
      exclusions: row.exclusions,
      customerRequirements: row.customerRequirements,
      typicalDuration: row.typicalDuration,
    };
  }

  /** Published services and active categories, for /sitemap.xml (P6-7). */
  async sitemapEntries(): Promise<{
    services: { slug: string; updatedAt: Date }[];
    categories: string[];
  }> {
    return this.db.run(ANONYMOUS, async (tx) => {
      const services = await tx.service.findMany({
        where: { status: 'PUBLISHED', category: { status: 'ACTIVE' } },
        select: { slug: true, updatedAt: true },
        orderBy: { slug: 'asc' },
        take: 45_000,
      });
      const categories = await tx.serviceCategory.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true },
        orderBy: { slug: 'asc' },
      });
      return { services, categories: categories.map((category) => category.slug) };
    });
  }

  // --------------------------------------------------------------------------

  private async categoryRows() {
    return this.db.run(ANONYMOUS, async (tx) => {
      const categories = await tx.serviceCategory.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          parentId: true,
          slug: true,
          name: true,
          summary: true,
          icon: true,
          position: true,
        },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
      const counts = await tx.service.groupBy({
        by: ['categoryId'],
        where: { status: 'PUBLISHED' },
        _count: { _all: true },
      });
      const countOf = new Map(counts.map((entry) => [entry.categoryId, entry._count._all]));
      return categories.map((category) => ({
        id: category.id,
        parent_id: category.parentId,
        slug: category.slug,
        name: category.name,
        summary: category.summary,
        icon: category.icon,
        own: countOf.get(category.id) ?? 0,
      }));
    });
  }

  private toCategory(
    row: {
      id: string;
      slug: string;
      name: string;
      summary: string | null;
      icon: string;
      own: number;
    },
    rows: readonly {
      id: string;
      parent_id: string | null;
      slug: string;
      name: string;
      summary: string | null;
      icon: string;
      own: number;
    }[],
  ): PublicCategory {
    const children = rows
      .filter((candidate) => candidate.parent_id === row.id)
      .map((child) => this.toCategory(child, rows));
    return {
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      icon: row.icon,
      serviceCount: row.own + children.reduce((sum, child) => sum + child.serviceCount, 0),
      children,
    };
  }

  private toSummary(row: SearchRow): PublicServiceSummary {
    return {
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      category: { slug: row.category_slug, name: row.category_name },
      audience: row.audience,
      deliveryMode: row.delivery_mode,
      price: row.has_price ? toPublicPrice(row) : null,
    };
  }
}

/** The filters a cursor belongs to: a cursor from another search is refused. */
function filterHash(query: CatalogueSearchQuery): string {
  const filters = [
    query.q?.trim() ?? '',
    query.category ?? '',
    query.model ?? '',
    query.audience ?? '',
    query.delivery ?? '',
    query.minPrice ?? '',
    query.maxPrice ?? '',
  ].join('\u0000');
  return createHash('sha256').update(filters).digest('base64url').slice(0, 16);
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Strict: anything malformed, tampered or from a different search → 400 invalid_cursor. */
function decodeCursor(raw: string, hash: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof parsed.k1 === 'string' &&
      /^-?\d{1,18}$/.test(parsed.k1) &&
      typeof parsed.k2 === 'string' &&
      parsed.k2.length <= 150 &&
      typeof parsed.id === 'string' &&
      UUID.test(parsed.id) &&
      parsed.h === hash
    ) {
      return { k1: parsed.k1, k2: parsed.k2, id: parsed.id, h: parsed.h };
    }
  } catch {
    // fall through
  }
  throw badRequest('invalid_cursor');
}
