import { Module } from '@nestjs/common';
import { InvitationService } from './invitation.service.js';
import { InvitationsController } from './invitations.controller.js';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationService],
})
export class InvitationsModule {}
