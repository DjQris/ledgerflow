const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface EnvironmentVariables {
  AUTH_ACCESS_TOKEN_TTL_SECONDS: number;
  AUTH_ALLOWED_ORIGIN: string;
  AUTH_AUDIENCE: string;
  AUTH_BCRYPT_ROUNDS: number;
  AUTH_COOKIE_SECURE: boolean;
  AUTH_ISSUER: string;
  AUTH_REFRESH_TOKEN_TTL_SECONDS: number;
  AUTH_SIGNING_KEY: string | null;
  CORS_ALLOWED_ORIGINS: string[];
  REQUEST_BODY_LIMIT_BYTES: number;
  DATABASE_URL: string;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  SERVICE_NAME: string;
}

export function validateEnvironment(
  values: Record<string, unknown>,
): EnvironmentVariables {
  const nodeEnvironment = values.NODE_ENV ?? 'development';
  const databaseUrl = values.DATABASE_URL;
  const rawPort = values.PORT ?? 3000;
  const serviceName = values.SERVICE_NAME ?? 'ledgerflow-api';
  const signingKey = values.AUTH_SIGNING_KEY;

  if (
    typeof nodeEnvironment !== 'string' ||
    !NODE_ENVIRONMENTS.includes(nodeEnvironment as NodeEnvironment)
  ) {
    throw new Error(`NODE_ENV must be one of: ${NODE_ENVIRONMENTS.join(', ')}`);
  }

  if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL must be a non-empty PostgreSQL URL');
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol',
    );
  }

  const port = typeof rawPort === 'number' ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
    throw new Error('SERVICE_NAME must be a non-empty string');
  }

  const normalizedSigningKey =
    typeof signingKey === 'string' && signingKey.length > 0 ? signingKey : null;
  if (
    normalizedSigningKey !== null &&
    Buffer.byteLength(normalizedSigningKey, 'utf8') < 32
  ) {
    throw new Error('AUTH_SIGNING_KEY must contain at least 32 UTF-8 bytes');
  }
  if (nodeEnvironment === 'production' && normalizedSigningKey === null) {
    throw new Error('AUTH_SIGNING_KEY is required in production');
  }

  const rawOrigin = values.AUTH_ALLOWED_ORIGIN ?? 'http://localhost:3000';
  if (typeof rawOrigin !== 'string') {
    throw new Error('AUTH_ALLOWED_ORIGIN must be a URL origin');
  }
  let allowedOrigin: URL;
  try {
    allowedOrigin = new URL(rawOrigin);
  } catch {
    throw new Error('AUTH_ALLOWED_ORIGIN must be a URL origin');
  }
  if (
    rawOrigin !== allowedOrigin.origin ||
    !['http:', 'https:'].includes(allowedOrigin.protocol) ||
    (nodeEnvironment === 'production' && allowedOrigin.protocol !== 'https:')
  ) {
    throw new Error('AUTH_ALLOWED_ORIGIN must be an exact allowed origin');
  }
  const rawOrigins = values.CORS_ALLOWED_ORIGINS ?? allowedOrigin.origin;
  if (typeof rawOrigins !== 'string') {
    throw new Error(
      'CORS_ALLOWED_ORIGINS must be a comma-separated origin list',
    );
  }
  const corsOrigins = rawOrigins.split(',').map((item) => item.trim());
  if (
    corsOrigins.length === 0 ||
    corsOrigins.some((item) => item.length === 0)
  ) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain exact origins');
  }
  for (const origin of corsOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact origins');
    }
    if (
      parsed.origin !== origin ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      (nodeEnvironment === 'production' && parsed.protocol !== 'https:')
    ) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain exact trusted origins',
      );
    }
  }

  const issuer = values.AUTH_ISSUER ?? 'ledgerflow-api';
  const audience = values.AUTH_AUDIENCE ?? 'ledgerflow-client';
  if (typeof issuer !== 'string' || issuer.trim().length === 0) {
    throw new Error('AUTH_ISSUER must be non-empty');
  }
  if (typeof audience !== 'string' || audience.trim().length === 0) {
    throw new Error('AUTH_AUDIENCE must be non-empty');
  }

  const accessTtl = readInteger(
    values.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    900,
    60,
    3600,
    'AUTH_ACCESS_TOKEN_TTL_SECONDS',
  );
  const bodyLimit = readInteger(
    values.REQUEST_BODY_LIMIT_BYTES,
    16_384,
    1024,
    1_048_576,
    'REQUEST_BODY_LIMIT_BYTES',
  );
  const refreshTtl = readInteger(
    values.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    604800,
    3600,
    2592000,
    'AUTH_REFRESH_TOKEN_TTL_SECONDS',
  );
  const bcryptRounds = readInteger(
    values.AUTH_BCRYPT_ROUNDS,
    12,
    12,
    15,
    'AUTH_BCRYPT_ROUNDS',
  );
  const secureValue = values.AUTH_COOKIE_SECURE;
  const cookieSecure =
    secureValue === undefined
      ? nodeEnvironment === 'production'
      : secureValue === true || secureValue === 'true';
  if (
    secureValue !== undefined &&
    ![true, false, 'true', 'false'].includes(secureValue as boolean | string)
  ) {
    throw new Error('AUTH_COOKIE_SECURE must be true or false');
  }
  if (
    (nodeEnvironment === 'production' || allowedOrigin.protocol === 'https:') &&
    !cookieSecure
  ) {
    throw new Error('AUTH_COOKIE_SECURE must be true for HTTPS or production');
  }

  return {
    AUTH_ACCESS_TOKEN_TTL_SECONDS: accessTtl,
    AUTH_ALLOWED_ORIGIN: allowedOrigin.origin,
    AUTH_AUDIENCE: audience.trim(),
    AUTH_BCRYPT_ROUNDS: bcryptRounds,
    AUTH_COOKIE_SECURE: cookieSecure,
    AUTH_ISSUER: issuer.trim(),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: refreshTtl,
    AUTH_SIGNING_KEY: normalizedSigningKey,
    CORS_ALLOWED_ORIGINS: [...new Set(corsOrigins)],
    REQUEST_BODY_LIMIT_BYTES: bodyLimit,
    DATABASE_URL: databaseUrl,
    NODE_ENV: nodeEnvironment as NodeEnvironment,
    PORT: port,
    SERVICE_NAME: serviceName.trim(),
  };
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
