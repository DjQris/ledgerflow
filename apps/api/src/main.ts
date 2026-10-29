import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { configureHttpSecurity } from './common/http-security';
import { EnvironmentVariables } from './config/environment';
import { buildSwaggerConfig } from './swagger-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.setGlobalPrefix('api/v1');
  configureHttpSecurity(app, {
    CORS_ALLOWED_ORIGINS: config.get('CORS_ALLOWED_ORIGINS', { infer: true }),
    REQUEST_BODY_LIMIT_BYTES: config.get('REQUEST_BODY_LIMIT_BYTES', {
      infer: true,
    }),
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
