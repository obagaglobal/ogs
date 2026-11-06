import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  catalogueServiceStatusSchema,
  createCategoryRequestSchema,
  createServiceRequestSchema,
  setPriceRequestSchema,
  setServiceSkillsRequestSchema,
  updateCategoryRequestSchema,
  updateServiceRequestSchema,
  type StaffCategoryListResponse,
  type StaffService,
  type StaffServiceListResponse,
} from '@ogs/contracts';
import { z } from 'zod';
import { Auth, Ctx, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import type { DbContext } from '../database/index.js';
import { CatalogueAdminService } from './catalogue-admin.service.js';

const versionSchema = z.object({ version: z.number().int().min(0) });
const MANAGE = 'platform.catalogue.manage';

/**
 * Staff management of the catalogue (Phase 6 plan §2.4). Every route needs an
 * elevation with platform.catalogue.manage (service manager, super admin).
 */
@Controller('platform/catalogue')
export class PlatformCatalogueController {
  constructor(private readonly catalogue: CatalogueAdminService) {}

  @Get('categories')
  @RequireElevation(MANAGE)
  @Header('Cache-Control', 'no-store')
  async categories(@Ctx() ctx: DbContext): Promise<StaffCategoryListResponse> {
    return { categories: await this.catalogue.categories(ctx) };
  }

  @Post('categories')
  @RequireElevation(MANAGE)
  async createCategory(@Body() body: unknown, @Ctx() ctx: DbContext, @Auth() auth: AccessState) {
    return this.catalogue.createCategory(
      ctx,
      parseBody(createCategoryRequestSchema, body),
      auth.meta,
    );
  }

  @Patch('categories/:id')
  @RequireElevation(MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    await this.catalogue.updateCategory(
      ctx,
      id,
      parseBody(updateCategoryRequestSchema, body),
      auth.meta,
    );
  }

  @Get('services')
  @RequireElevation(MANAGE)
  @Header('Cache-Control', 'no-store')
  async services(
    @Query('status') status: unknown,
    @Ctx() ctx: DbContext,
  ): Promise<StaffServiceListResponse> {
    const parsed = catalogueServiceStatusSchema.optional().safeParse(status);
    return {
      services: await this.catalogue.services(ctx, parsed.success ? parsed.data : undefined),
    };
  }

  @Post('services')
  @RequireElevation(MANAGE)
  async createService(
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    return this.catalogue.createService(
      ctx,
      parseBody(createServiceRequestSchema, body),
      auth.meta,
    );
  }

  @Get('services/:id')
  @RequireElevation(MANAGE)
  @Header('Cache-Control', 'no-store')
  async service(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
  ): Promise<StaffService> {
    return this.catalogue.service(ctx, id);
  }

  @Patch('services/:id')
  @RequireElevation(MANAGE)
  async updateService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    return this.catalogue.updateService(
      ctx,
      id,
      parseBody(updateServiceRequestSchema, body),
      auth.meta,
    );
  }

  @Post('services/:id/prices')
  @RequireElevation(MANAGE)
  async setPrice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    return this.catalogue.setPrice(ctx, id, parseBody(setPriceRequestSchema, body), auth.meta);
  }

  @Put('services/:id/skills')
  @RequireElevation(MANAGE)
  async setSkills(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    const { skills } = parseBody(setServiceSkillsRequestSchema, body);
    return this.catalogue.setSkills(ctx, id, skills, auth.meta);
  }

  @Post('services/:id/publish')
  @RequireElevation(MANAGE)
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    return this.catalogue.transition(
      ctx,
      id,
      'PUBLISHED',
      parseBody(versionSchema, body).version,
      auth.meta,
    );
  }

  @Post('services/:id/retire')
  @RequireElevation(MANAGE)
  @HttpCode(HttpStatus.OK)
  async retire(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    return this.catalogue.transition(
      ctx,
      id,
      'RETIRED',
      parseBody(versionSchema, body).version,
      auth.meta,
    );
  }

  @Post('services/:id/restore')
  @RequireElevation(MANAGE)
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<StaffService> {
    return this.catalogue.transition(
      ctx,
      id,
      'DRAFT',
      parseBody(versionSchema, body).version,
      auth.meta,
    );
  }
}
