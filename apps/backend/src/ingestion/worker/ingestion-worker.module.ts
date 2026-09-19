import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from '../../config/app-config.service';
import { IngestionJobEntity } from '../database/entities/ingestion-job.entity';
import { IngestionJobsRepository } from '../database/repositories/ingestion-jobs.repository';
import { SqsIngestionPollerService } from './sqs-ingestion-poller.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([IngestionJobEntity]),
  ],
  providers: [
    AppConfigService,
    IngestionJobsRepository,
    SqsIngestionPollerService,
  ],
  exports: [
    IngestionJobsRepository,
    SqsIngestionPollerService,
  ],
})
export class IngestionWorkerModule {}
