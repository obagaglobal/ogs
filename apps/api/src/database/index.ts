/**
 * Public surface of the database layer. Feature modules import from here and
 * never from `../generated/prisma` (enforced by ESLint, see eslint.config.js).
 */
export { DatabaseModule } from './database.module.js';
export { DatabaseHealth } from './database-health.service.js';
export { TenantDb, type Db, type RunOptions } from './tenant-db.service.js';
export { InvalidDbContextError, type DbContext } from './db-context.js';
export {
  ActorKind,
  MembershipStatus,
  TenantKind,
  TenantStatus,
  UserStatus,
} from '../generated/prisma/enums.js';
export { Prisma } from '../generated/prisma/client.js';
export type {
  AuditLog,
  Membership,
  OutboxEvent,
  Tenant,
  AppUser,
} from '../generated/prisma/client.js';
