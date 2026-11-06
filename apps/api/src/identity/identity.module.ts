import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { IdentityService } from './identity.service.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordPolicy } from './password-policy.js';
import { RateLimiter } from './rate-limiter.js';

/** Accounts, passwords and sign-in (Phase 3A). */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    { provide: PasswordPolicy, useFactory: () => new PasswordPolicy() },
    RateLimiter,
    IdentityService,
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
