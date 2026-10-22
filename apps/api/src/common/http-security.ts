import { INestApplication, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { NextFunction, Request, Response, json, urlencoded } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';

import { AuthenticatedRequest } from '../auth/guards/authentication.guard';
import { EnvironmentVariables } from '../config/environment';

export function sanitizedPath(request: Request): string {
  const route: unknown = (request as unknown as { route?: { path?: unknown } })
    .route?.path;
  return typeof route === 'string' && route.startsWith('/')
    ? route.slice(0, 150)
    : '/unmatched';
}

export function configureHttpSecurity(
  app: INestApplication,
  config: Pick<
    EnvironmentVariables,
    'NODE_ENV' | 'CORS_ALLOWED_ORIGINS' | 'REQUEST_BODY_LIMIT_BYTES'
  >,
): void {
  const production = config.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: production ? undefined : false,
      hsts: production
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
    }),
  );
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) =>
      callback(null, !origin || config.CORS_ALLOWED_ORIGINS.includes(origin)),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-CSRF-Token', 'X-Request-Id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.use(json({ limit: config.REQUEST_BODY_LIMIT_BYTES }));
  app.use(
    urlencoded({ extended: false, limit: config.REQUEST_BODY_LIMIT_BYTES }),
  );
  app.use(cookieParser());
  app.use(
    (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
      const requestId = randomUUID();
      const started = process.hrtime.bigint();
      response.setHeader('X-Request-Id', requestId);
      response.on('finish', () => {
        if (config.NODE_ENV === 'test') return;
        Logger.log(
          JSON.stringify({
            requestId,
            method: request.method,
            path: sanitizedPath(request),
            status: response.statusCode,
            durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
            actorId: request.authenticatedUser?.id ?? null,
          }),
          'HttpRequest',
        );
      });
      next();
    },
  );
}
