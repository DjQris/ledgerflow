import { RedisOptions } from 'bullmq';

export interface BackgroundEnvironment {
  DATABASE_URL: string;
  NODE_ENV: 'development' | 'test' | 'production';
  REDIS_URL: string;
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
    DATABASE_URL: databaseUrl,
    NODE_ENV: nodeEnv as BackgroundEnvironment['NODE_ENV'],
    REDIS_URL: redisUrl,
  };
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
): RedisOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    connectTimeout: 2_000,
    enableOfflineQueue: role === 'worker',
    maxRetriesPerRequest: role === 'worker' ? null : 1,
    retryStrategy:
      role === 'worker'
        ? (attempt) => Math.min(500 * attempt, 5_000)
        : () => null,
  };
}
