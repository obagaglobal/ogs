import { Global, Module } from '@nestjs/common';
import { SessionStore } from './session.store.js';

@Global()
@Module({
  providers: [SessionStore],
  exports: [SessionStore],
})
export class SessionsModule {}
