import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { AppConfigService } from './config/app-config.service';
import { getEnvFilePaths } from './config/env-loader';
import { dataSourceOptions } from './database/data-source';

import { IngestionModule } from './ingestion/ingestion.module';
import { IngestionWorkerModule } from './ingestion/worker/ingestion-worker.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      validate: validateEnv,
    }),
    TypeOrmModule.forRoot(dataSourceOptions),
    IngestionModule,
    IngestionWorkerModule,
    RetrievalModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService, AppConfigService],
  exports: [AppConfigService],
})
export class AppModule { }
