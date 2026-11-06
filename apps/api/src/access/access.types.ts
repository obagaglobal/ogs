import type { Request } from 'express';
import type { DbContext, UserStatus } from '../database/index.js';
import type { RequestMeta } from '../identity/identity.service.js';
import type { SessionRecord } from '../sessions/session.store.js';
import type { ResolvedWorkspace } from '../tenancy/workspace-context.service.js';

export interface AccessState {
  readonly sessionToken: string;
  readonly session: SessionRecord;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly status: UserStatus;
    readonly mfaEnabled: boolean;
  };
  readonly meta: RequestMeta;
  readonly workspace?: {
    readonly resolved: ResolvedWorkspace;
    readonly context: DbContext;
    readonly permissions: ReadonlySet<string>;
  };
}

export type OgsRequest = Request & { ogs?: AccessState; requestId?: string };
