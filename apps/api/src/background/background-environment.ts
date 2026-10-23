import { RedisOptions } from 'bullmq';

export interface BackgroundEnvironment {
  BACKGROUND_JOB_MAX_ATTEMPTS: number;
  BACKGROUND_RETRY_DELAY_MS: number;
  DATABASE_URL: string;
  DISPATCHER_HEALTH_PORT: number;
  NODE_ENV: 'development' | 'test' | 'production';
  REDIS_CONNECT_TIMEOUT_MS: number;
  REDIS_URL: string;
  WORKER_HEALTH_PORT: number;
}

export function validateBackgroundEnvironment(
  values: Record<string, unknown>,
): BackgroundEnvironment {
  const nodeEnv = values.NODE_ENV ?? 'development';
  const databaseUrl = values.DATABASE_URL;
  const redisUrl = values.REDIS_URL ?? 'redis://127.0.0.1:6379';
  if (
    typeof nodeEnv !== 'string' ||
    !['development', 'test', 'production'].includes(nodeEnv)
  ) {
    throw new Error('Invalid NODE_ENV');
  }
  if (
    typeof databaseUrl !== 'string' ||
    !isUrl(databaseUrl, ['postgres:', 'postgresql:'], false)
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  if (
    typeof redisUrl !== 'string' ||
    !isUrl(redisUrl, ['redis:', 'rediss:'], true)
  ) {
    throw new Error('REDIS_URL must be a Redis URL');
  }
  if (nodeEnv === 'production' && new URL(redisUrl).protocol !== 'rediss:') {
    throw new Error('Production REDIS_URL must use rediss://');
  }
  return {
    BACKGROUND_JOB_MAX_ATTEMPTS: boundedInteger(
      values.BACKGROUND_JOB_MAX_ATTEMPTS,
      5,
      1,
      20,
      'BACKGROUND_JOB_MAX_ATTEMPTS',
    ),
    BACKGROUND_RETRY_DELAY_MS: boundedInteger(
      values.BACKGROUND_RETRY_DELAY_MS,
      1_000,
      100,
      60_000,
      'BACKGROUND_RETRY_DELAY_MS',
    ),
    DATABASE_URL: databaseUrl,
    DISPATCHER_HEALTH_PORT: boundedInteger(
      values.DISPATCHER_HEALTH_PORT,
      3101,
      1,
      65_535,
      'DISPATCHER_HEALTH_PORT',
    ),
    NODE_ENV: nodeEnv as BackgroundEnvironment['NODE_ENV'],
    REDIS_CONNECT_TIMEOUT_MS: boundedInteger(
      values.REDIS_CONNECT_TIMEOUT_MS,
      2_000,
      500,
      30_000,
      'REDIS_CONNECT_TIMEOUT_MS',
    ),
    REDIS_URL: redisUrl,
    WORKER_HEALTH_PORT: boundedInteger(
      values.WORKER_HEALTH_PORT,
      3102,
      1,
      65_535,
      'WORKER_HEALTH_PORT',
    ),
  };
}

export function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function isUrl(
  value: string,
  protocols: string[],
  restrictPath: boolean,
): boolean {
  try {
    const url = new URL(value);
    return (
      protocols.includes(url.protocol) &&
      !!url.hostname &&
      (!restrictPath || url.pathname === '' || url.pathname === '/') &&
      (!restrictPath || (!url.search && !url.hash))
    );
  } catch {
    return false;
  }
}

export function redisConnection(
  redisUrl: string,
  role: 'dispatcher' | 'worker',
  connectTimeout = 2_000,
): RedisOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    connectTimeout,
    enableOfflineQueue: role === 'worker',
    maxRetriesPerRequest: role === 'worker' ? null : 1,
    retryStrategy:
      role === 'worker'
        ? (attempt) => Math.min(500 * attempt, 5_000)
        : () => null,
  };
}
