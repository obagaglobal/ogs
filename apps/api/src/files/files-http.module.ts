import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';

/** HTTP upload/download (API only; FileService itself comes from the global FilesModule). */
@Module({
  controllers: [FilesController],
})
export class FilesHttpModule {}
