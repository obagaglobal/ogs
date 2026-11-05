import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGINT/SIGTERM: stop dispatching, drain in-flight jobs, close connections.
  app.enableShutdownHooks();
  Logger.log('Worker started (outbox dispatcher + event consumer)', 'Bootstrap');
}

await bootstrap();
