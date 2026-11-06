import { Controller, Get, Header, Inject, Logger, Param, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  catalogueSearchQuerySchema,
  catalogueSlugSchema,
  type PublicCategoryResponse,
  type PublicCategoryTreeResponse,
  type PublicServiceDetail,
  type PublicServiceListResponse,
} from '@ogs/contracts';
import { Public } from '../access/access.decorators.js';
import type { OgsRequest } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { requestMeta } from '../access/request-meta.js';
import { notFound } from '../common/domain-error.js';
import type { TypedConfigService } from '../config/env.js';
import { RateLimiter, RateLimiterUnavailable } from '../identity/rate-limiter.js';
import { CataloguePublicService } from './catalogue-public.service.js';

/**
 * Cacheable, but always revalidated: a retired service must disappear at once
 * (E6), even for a visitor whose browser has seen it. Express's ETag turns an
 * unchanged answer into a cheap 304.
 */
const PUBLIC_CACHE = 'public, no-cache';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The public catalogue (Phase 6 plan §2.2): no sign-in, read-only, rate
 * limited per IP. Hidden or unknown items answer 404, never 403.
 */
@Controller('catalogue')
export class CataloguePublicController {
  private readonly logger = new Logger(CataloguePublicController.name);
  private readonly siteUrl: string;

  constructor(
    private readonly catalogue: CataloguePublicService,
    private readonly limiter: RateLimiter,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.siteUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
  }

  @Get('categories')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async categories(@Req() request: OgsRequest): Promise<PublicCategoryTreeResponse> {
    await this.limit(request);
    return { categories: await this.catalogue.categories() };
  }

  @Get('categories/:slug')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async category(
    @Param('slug') slug: string,
    @Req() request: OgsRequest,
  ): Promise<PublicCategoryResponse> {
    await this.limit(request);
    return this.catalogue.category(validSlug(slug));
  }

  @Get('services')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async services(
    @Query() query: unknown,
    @Req() request: OgsRequest,
  ): Promise<PublicServiceListResponse> {
    await this.limit(request);
    return this.catalogue.search(parseBody(catalogueSearchQuerySchema, query));
  }

  @Get('services/:slug')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async service(
    @Param('slug') slug: string,
    @Req() request: OgsRequest,
  ): Promise<PublicServiceDetail> {
    await this.limit(request);
    return this.catalogue.service(validSlug(slug));
  }

  /** Sitemap of the public catalogue (P6-7); web/public/robots.txt points here. */
  @Get('sitemap.xml')
  @Public()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap(@Req() request: OgsRequest): Promise<string> {
    await this.limit(request);
    const { services, categories } = await this.catalogue.sitemapEntries();
    const url = (path: string, lastmod?: Date) =>
      `  <url><loc>${escapeXml(`${this.siteUrl}${path}`)}</loc>${
        lastmod === undefined ? '' : `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>`
      }</url>`;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url('/services'),
      ...categories.map((slug) => url(`/services/c/${slug}`)),
      ...services.map((service) => url(`/services/${service.slug}`, service.updatedAt)),
      '</urlset>',
      '',
    ].join('\n');
  }

  /**
   * Per-IP ceiling (E8). If Redis is down the catalogue stays readable: unlike
   * sign-in, browsing has nothing to protect that a limiter outage exposes.
   */
  private async limit(request: OgsRequest): Promise<void> {
    try {
      await this.limiter.consume('cataloguePerIp', requestMeta(request).ip ?? 'unknown');
    } catch (error) {
      if (error instanceof RateLimiterUnavailable) {
        this.logger.warn('rate limiter unavailable; serving the catalogue without a limit');
        return;
      }
      throw error;
    }
  }
}

/** A malformed slug can never match: answer 404 without touching the database. */
function validSlug(slug: string): string {
  const parsed = catalogueSlugSchema.safeParse(slug);
  if (!parsed.success || parsed.data !== slug) {
    throw notFound();
  }
  return parsed.data;
}
