import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { EnvironmentVariables } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LedgerFlow API')
    .setDescription('LedgerFlow backend API documentation')
    .setVersion('1.0')
    .addTag('health')
    .addTag('wallets')
    .addTag('transfers')
    .addTag('audit')
    .addTag('auth')
    .addCookieAuth(
      'ledgerflow_access',
      {
        description: 'HTTP-only access cookie (production uses __Host- prefix)',
        in: 'cookie',
        name: 'ledgerflow_access',
        type: 'apiKey',
      },
      'access-cookie',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
