import { TenantKind } from '../database/index.js';
import { forbiddenRule } from '../common/domain-error.js';
import type { AccessState } from '../access/access.types.js';
import type { ProviderSubject } from './provider.service.js';

/**
 * Which provider a request acts as (Phase 5 plan §2.1, P5-2):
 *
 * - the Provider workspace (`X-OGS-Workspace: provider`) → the person's own
 *   individual profile, in their `user` context;
 * - a PROVIDER_COMPANY workspace → that company; reading needs
 *   `workspace.read`, changing needs `provider.profile.manage`.
 *
 * Every other workspace (personal, organisation, platform) is refused, so a
 * company role never reaches an individual profile and vice versa.
 */
export function providerSubject(auth: AccessState, access: 'read' | 'manage'): ProviderSubject {
  const workspace = auth.workspace;
  if (workspace === undefined) {
    throw forbiddenRule('workspace_forbidden');
  }
  const resolved = workspace.resolved;
  if (resolved.kind === 'provider') {
    return { ctx: workspace.context, kind: 'INDIVIDUAL', userId: auth.user.id };
  }
  if (resolved.kind === TenantKind.PROVIDER_COMPANY) {
    const needed = access === 'manage' ? 'provider.profile.manage' : 'workspace.read';
    if (!workspace.permissions.has(needed)) {
      throw forbiddenRule('permission_denied');
    }
    return {
      ctx: workspace.context,
      kind: 'COMPANY',
      userId: auth.user.id,
      tenantId: resolved.tenantId,
    };
  }
  throw forbiddenRule('not_a_provider_workspace');
}
