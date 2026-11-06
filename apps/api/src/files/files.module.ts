import { Global, Module } from '@nestjs/common';
import { FileService } from './file.service.js';
import { ObjectStorage } from './object-storage.js';

/** Upload and download side of file storage (API and worker). */
@Global()
@Module({
  providers: [ObjectStorage, FileService],
  exports: [ObjectStorage, FileService],
})
export class FilesModule {}
