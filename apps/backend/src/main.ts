/* Must stay first: sets WORKER_ENABLED=false before config is loaded */
import './process-role/api';
import { sdk } from './instrumentation';
sdk.start();

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { registerGracefulShutdown } from './common/shutdown';

/* Safety net: log a stray rejection instead of letting one request take the process down */
process.on('unhandledRejection', (reason: unknown) => {
  new Logger('Process').error(
    'Unhandled promise rejection',
    reason instanceof Error ? reason.stack : String(reason),
  );
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(AppConfigService);

  app.enableCors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    /* No cookie-based auth exists, so the browser must not send credentials cross-origin */
    credentials: false,
  });

  app.setGlobalPrefix('api', {
    exclude: ['metrics', ''],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  /* API docs outside production only: /api/docs */
  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Knowledge Engine API')
        .setVersion(config.otelServiceVersion)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  registerGracefulShutdown(app, 'ApiMain');

  await app.listen(config.port, '0.0.0.0');
  new Logger('ApiMain').log(`Backend running on http://localhost:${config.port}/api`);
}

bootstrap();
