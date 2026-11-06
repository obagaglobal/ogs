import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  type AcceptInvitationResponse,
  type Invitation,
  type InvitationListResponse,
} from '@ogs/contracts';
import { Auth, Authenticated, Ctx, RequirePermission } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { notFound } from '../common/domain-error.js';
import type { DbContext, TenantKind } from '../database/index.js';
import { InvitationService } from './invitation.service.js';

export function tenantKindOf(auth: AccessState): TenantKind {
  const resolved = auth.workspace?.resolved;
  if (resolved === undefined || resolved.kind === 'personal') {
    throw notFound();
  }
  return resolved.kind;
}

@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  @Post('workspace/invitations')
  @RequirePermission('membership.invite')
  async create(
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<Invitation> {
    const input = parseBody(createInvitationRequestSchema, body);
    return this.invitations.create(ctx, tenantKindOf(auth), input, auth.user.id, auth.meta);
  }

  @Get('workspace/invitations')
  @RequirePermission('membership.invite')
  @Header('Cache-Control', 'no-store')
  async list(@Ctx() ctx: DbContext): Promise<InvitationListResponse> {
    return { invitations: await this.invitations.list(ctx) };
  }

  @Delete('workspace/invitations/:id')
  @RequirePermission('membership.invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    await this.invitations.revoke(ctx, id, auth.meta);
  }

  /** The signed-in, verified invitee accepts (email must match the invitation). */
  @Post('invitations/accept')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<AcceptInvitationResponse> {
    const { token } = parseBody(acceptInvitationRequestSchema, body);
    return this.invitations.accept(auth.user, token, auth.meta);
  }
}
