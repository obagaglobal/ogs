import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AccessRouteCheck } from '../src/access/access-route-check.js';
import { Public, RequirePermission } from '../src/access/access.decorators.js';
import { AppModule } from '../src/app.module.js';
import { AuthzSyncService } from '../src/authz/authz-sync.service.js';

/** A8 — default deny: every route declares an access rule, or the API does not start. */
describe('access rules (A8)', () => {
  it('every route of the real API declares a rule naming a known permission', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthzSyncService)
      .useValue({ onApplicationBootstrap: () => undefined })
      .compile();
    const check = moduleRef.get(AccessRouteCheck);
    const routes = check.routes();
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.filter((route) => route.rule === undefined)).toEqual([]);
    expect(() => {
      check.onApplicationBootstrap();
    }).not.toThrow();
  });

  it('refuses to start when a route has no rule or names an unknown permission', async () => {
    @Controller('bad')
    class BadController {
      @Get('open')
      @Public()
      open() {
        return 'ok';
      }

      @Get('forgotten')
      forgotten() {
        return 'oops';
      }

      @Get('typo')
      @RequirePermission('membership.raed')
      typo() {
        return 'oops';
      }
    }
    @Module({
      imports: [DiscoveryModule],
      controllers: [BadController],
      providers: [AccessRouteCheck],
    })
    class BadModule {}

    const moduleRef = await Test.createTestingModule({ imports: [BadModule] }).compile();
    expect(() => {
      moduleRef.get(AccessRouteCheck).onApplicationBootstrap();
    }).toThrow(
      /BadController\.forgotten: no access rule[\s\S]*BadController\.typo: unknown permission/,
    );
  });
});
