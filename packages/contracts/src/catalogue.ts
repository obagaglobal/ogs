import { z } from 'zod';
import { experienceBandSchema, skillCodeSchema } from './providers.js';

/**
 * Phase 6: the service catalogue. Money is ALWAYS an integer number of minor
 * units (cents), never a float (review §13, Phase 6 and 11 rows). Prices are
 * stored and sent excluding VAT (P6-8); display labels are built here, once,
 * and used by both the API and the web app.
 */

/** At most 10 billion shillings: far inside JavaScript's safe-integer range. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;
export const moneyMinorSchema = z.number().int().min(0).max(MAX_AMOUNT_MINOR);

/** Indicative VAT for display only (ADR-017); real tax lines come in Phases 7 and 11. */
export const VAT_RATE_PERCENT = 16;

export const catalogueStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const catalogueServiceStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']);
export const serviceAudienceSchema = z.enum(['ALL', 'ORGANISATIONS', 'INDIVIDUALS']);
export const deliveryModeSchema = z.enum(['ON_SITE', 'REMOTE', 'BOTH']);
export const priceModelSchema = z.enum(['FIXED', 'PER_UNIT', 'FROM', 'QUOTE']);
export const priceUnitSchema = z.enum(['HOUR', 'DEVICE', 'USER', 'VISIT', 'POINT']);

export type CatalogueServiceStatus = z.infer<typeof catalogueServiceStatusSchema>;
export type ServiceAudience = z.infer<typeof serviceAudienceSchema>;
export type DeliveryMode = z.infer<typeof deliveryModeSchema>;
export type PriceModel = z.infer<typeof priceModelSchema>;
export type PriceUnit = z.infer<typeof priceUnitSchema>;

export const catalogueSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: 'Lower-case letters, digits and single hyphens' });

/** Icons come from a fixed set (no uploads in Phase 6). */
export const CATEGORY_ICONS = [
  'folder',
  'network',
  'wifi',
  'cctv',
  'laptop',
  'printer',
  'cloud',
  'server',
  'shield',
  'phone',
  'store',
  'database',
  'wrench',
] as const;
export const categoryIconSchema = z.enum(CATEGORY_ICONS);

// ---------------------------------------------------------------- money and labels

const UNIT_LABELS: Record<PriceUnit, [string, string]> = {
  HOUR: ['hour', 'hours'],
  DEVICE: ['device', 'devices'],
  USER: ['user', 'users'],
  VISIT: ['visit', 'visits'],
  POINT: ['cabling point', 'cabling points'],
};

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

/** Indicative VAT-inclusive amount, rounded half up to the cent. */
export function withIndicativeVat(amountMinor: number): number {
  return amountMinor + Math.round((amountMinor * VAT_RATE_PERCENT) / 100);
}

export interface PriceLike {
  readonly model: PriceModel;
  readonly amountMinor: number | null;
  readonly unit: PriceUnit | null;
  readonly minQuantity: number;
}

/** The one place a price becomes words (server-computed, review §11). */
export function priceLabel(price: PriceLike): string {
  switch (price.model) {
    case 'QUOTE':
      return 'Price on quotation';
    case 'FIXED':
      return formatKes(price.amountMinor ?? 0);
    case 'FROM':
      return `From ${formatKes(price.amountMinor ?? 0)}`;
    case 'PER_UNIT': {
      const [one, many] = UNIT_LABELS[price.unit ?? 'HOUR'];
      const minimum = price.minQuantity > 1 ? ` (min. ${String(price.minQuantity)} ${many})` : '';
      return `${formatKes(price.amountMinor ?? 0)} per ${one}${minimum}`;
    }
  }
}

// ---------------------------------------------------------------- public DTOs

export const publicPriceSchema = z.object({
  model: priceModelSchema,
  amountMinor: moneyMinorSchema.nullable(),
  currency: z.literal('KES'),
  unit: priceUnitSchema.nullable(),
  minQuantity: z.number().int().min(1),
  /** e.g. "KES 1,200 per device (min. 5 devices)". Excludes VAT. */
  label: z.string(),
  /** Indicative amount including VAT, or null for quotation-only prices. */
  vatInclusiveMinor: moneyMinorSchema.nullable(),
});
export type PublicPrice = z.infer<typeof publicPriceSchema>;

const publicCategoryRefSchema = z.object({ slug: z.string(), name: z.string() });

export const publicServiceSummarySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    summary: z.string(),
    category: publicCategoryRefSchema,
    audience: serviceAudienceSchema,
    deliveryMode: deliveryModeSchema,
    price: publicPriceSchema.nullable(),
  })
  .strict();
export const publicServiceDetailSchema = publicServiceSummarySchema
  .extend({
    description: z.string(),
    inclusions: z.array(z.string()),
    exclusions: z.array(z.string()),
    customerRequirements: z.array(z.string()),
    typicalDuration: z.string().nullable(),
    parentCategory: publicCategoryRefSchema.nullable(),
  })
  .strict();
export type PublicServiceSummary = z.infer<typeof publicServiceSummarySchema>;
export type PublicServiceDetail = z.infer<typeof publicServiceDetailSchema>;

export interface PublicCategory {
  slug: string;
  name: string;
  summary: string | null;
  icon: string;
  serviceCount: number;
  children: PublicCategory[];
}
export const publicCategorySchema: z.ZodType<PublicCategory> = z.lazy(() =>
  z
    .object({
      slug: z.string(),
      name: z.string(),
      summary: z.string().nullable(),
      icon: z.string(),
      serviceCount: z.number().int(),
      children: z.array(publicCategorySchema),
    })
    .strict(),
);
export const publicCategoryTreeResponseSchema = z.object({
  categories: z.array(publicCategorySchema),
});
export const publicCategoryResponseSchema = z.object({
  category: publicCategorySchema,
  parent: publicCategoryRefSchema.nullable(),
});
export const publicServiceListResponseSchema = z.object({
  services: z.array(publicServiceSummarySchema),
  /** Opaque; pass back as `cursor` for the next page. Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type PublicCategoryTreeResponse = z.infer<typeof publicCategoryTreeResponseSchema>;
export type PublicCategoryResponse = z.infer<typeof publicCategoryResponseSchema>;
export type PublicServiceListResponse = z.infer<typeof publicServiceListResponseSchema>;

export const CATALOGUE_PAGE_SIZE = 20;
export const CATALOGUE_MAX_PAGE_SIZE = 50;

/** Query string of GET /catalogue/services (all values arrive as strings). */
export const catalogueSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: catalogueSlugSchema.optional(),
  model: priceModelSchema.optional(),
  audience: serviceAudienceSchema.optional(),
  delivery: deliveryModeSchema.optional(),
  minPrice: z.coerce.number().pipe(moneyMinorSchema).optional(),
  maxPrice: z.coerce.number().pipe(moneyMinorSchema).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(CATALOGUE_MAX_PAGE_SIZE).optional(),
});
export type CatalogueSearchQuery = z.infer<typeof catalogueSearchQuerySchema>;

// ---------------------------------------------------------------- staff

const textLine = z.string().trim().min(1).max(300);

export const createCategoryRequestSchema = z.object({
  slug: catalogueSlugSchema.max(80),
  name: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(300).nullable().optional(),
  icon: categoryIconSchema.optional(),
  parentSlug: catalogueSlugSchema.nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export const updateCategoryRequestSchema = z
  .object({
    version: z.number().int().min(0),
    name: z.string().trim().min(2).max(120).optional(),
    summary: z.string().trim().max(300).nullable().optional(),
    icon: categoryIconSchema.optional(),
    parentSlug: catalogueSlugSchema.nullable().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    status: catalogueStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { error: 'Nothing to change' });

export const serviceContentSchema = z.object({
  name: z.string().trim().min(2).max(150),
  summary: z.string().trim().max(300),
  description: z.string().trim().max(5000),
  inclusions: z.array(textLine).max(30),
  exclusions: z.array(textLine).max(30),
  customerRequirements: z.array(textLine).max(30),
  typicalDuration: z.string().trim().max(100).nullable(),
  audience: serviceAudienceSchema,
  deliveryMode: deliveryModeSchema,
  channelOgs: z.boolean(),
  channelIndividual: z.boolean(),
  channelCompany: z.boolean(),
});
export const createServiceRequestSchema = serviceContentSchema.partial().extend({
  slug: catalogueSlugSchema,
  name: z.string().trim().min(2).max(150),
  categorySlug: catalogueSlugSchema,
});
export const updateServiceRequestSchema = serviceContentSchema
  .partial()
  .extend({
    version: z.number().int().min(0),
    categorySlug: catalogueSlugSchema.optional(),
    slug: catalogueSlugSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { error: 'Nothing to change' })
  .refine(
    (value) =>
      value.channelOgs !== false ||
      value.channelIndividual !== false ||
      value.channelCompany !== false,
    { error: 'At least one delivery channel', path: ['channelOgs'] },
  );

/** A new price version (P6-2, P6-3). Exactly the fields its model needs. */
export const setPriceRequestSchema = z.discriminatedUnion('model', [
  z.object({ model: z.literal('FIXED'), amountMinor: moneyMinorSchema }),
  z.object({ model: z.literal('FROM'), amountMinor: moneyMinorSchema }),
  z.object({
    model: z.literal('PER_UNIT'),
    amountMinor: moneyMinorSchema,
    unit: priceUnitSchema,
    minQuantity: z.number().int().min(1).max(10_000).default(1),
  }),
  z.object({ model: z.literal('QUOTE') }),
]);
export type SetPriceRequest = z.infer<typeof setPriceRequestSchema>;

export const setServiceSkillsRequestSchema = z.object({
  skills: z
    .array(z.object({ code: skillCodeSchema, minExperience: experienceBandSchema }))
    .max(20)
    .refine((items) => new Set(items.map((item) => item.code)).size === items.length, {
      error: 'Each skill once',
    }),
});

export const staffPriceSchema = publicPriceSchema.extend({
  id: z.uuid(),
  effectiveFrom: z.iso.datetime(),
});
export const staffCategorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  icon: z.string(),
  position: z.number().int(),
  status: catalogueStatusSchema,
  parentSlug: z.string().nullable(),
  version: z.number().int(),
  serviceCount: z.number().int(),
});
export const staffCategoryListResponseSchema = z.object({
  categories: z.array(staffCategorySchema),
});
export const staffServiceSchema = serviceContentSchema.extend({
  id: z.uuid(),
  slug: z.string(),
  status: catalogueServiceStatusSchema,
  category: z.object({ slug: z.string(), name: z.string(), status: catalogueStatusSchema }),
  publishedAt: z.iso.datetime().nullable(),
  retiredAt: z.iso.datetime().nullable(),
  version: z.number().int(),
  price: staffPriceSchema.nullable(),
  priceHistory: z.array(staffPriceSchema),
  skills: z.array(
    z.object({ code: z.string(), name: z.string(), minExperience: experienceBandSchema }),
  ),
  /** What still blocks publishing (empty when it can be published). */
  missing: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export const staffServiceListResponseSchema = z.object({
  services: z.array(
    staffServiceSchema.pick({
      id: true,
      slug: true,
      name: true,
      status: true,
      category: true,
      price: true,
      updatedAt: true,
    }),
  ),
});
export type StaffCategory = z.infer<typeof staffCategorySchema>;
export type StaffCategoryListResponse = z.infer<typeof staffCategoryListResponseSchema>;
export type StaffService = z.infer<typeof staffServiceSchema>;
export type StaffServiceListResponse = z.infer<typeof staffServiceListResponseSchema>;
