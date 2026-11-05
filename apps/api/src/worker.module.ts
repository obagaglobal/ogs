import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { EventsWorkerModule } from './events/events-worker.module.js';

/** The background worker process: same modules as the API, no HTTP. */
@Module({
  imports: [CoreModule, EventsWorkerModule],
})
export class WorkerModule {}
