import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PERMISSION_CODES } from '../authz/catalogue.js';
import { ACCESS_METADATA, type AccessRule } from './access.decorators.js';

export interface RouteAccess {
  readonly route: string;
  readonly rule: AccessRule | undefined;
}

/**
 * Default deny, enforced at start-up (Phase 3 plan §2.4, test A8): every route
 * handler must declare @Public(), @Authenticated() or @RequirePermission(), and
 * every permission named must exist in the catalogue. The API refuses to start
 * otherwise.
 */
@Injectable()
export class AccessRouteCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const problems = this.routes()
      .map(({ route, rule }) => {
        if (rule === undefined) {
          return `${route}: no access rule (add @Public, @Authenticated or @RequirePermission)`;
        }
        if (rule.kind === 'permission' && !PERMISSION_CODES.has(rule.code)) {
          return `${route}: unknown permission "${rule.code}"`;
        }
        return undefined;
      })
      .filter((problem): problem is string => problem !== undefined);
    if (problems.length > 0) {
      throw new Error(`Access rule check failed:\n  ${problems.join('\n  ')}`);
    }
  }

  routes(): RouteAccess[] {
    const routes: RouteAccess[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (instance === undefined || instance === null || metatype === null) {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[name];
        if (
          typeof handler !== 'function' ||
          this.reflector.get(PATH_METADATA, handler) === undefined
        ) {
          continue;
        }
        const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_METADATA, [
          handler,
          metatype,
        ]);
        routes.push({ route: `${metatype.name}.${name}`, rule });
      }
    }
    return routes;
  }
}
