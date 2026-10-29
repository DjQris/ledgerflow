const INTEGRATION_DB_PREFIX = 'ledgerflow_phase1f_integration_';
const TEST_DB_USER = 'ledgerflow_phase4_test';
const TEST_DB_PORT = '55432';
const TEST_REDIS_PORT = '56379';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Fail closed unless the API integration suite is pointed at Phase 4's local-only services. */
export function requirePhase4IntegrationEnvironment(
  options: { redis?: boolean } = {},
): { databaseUrl: string; redisUrl?: string } {
  if (process.env.LEDGERFLOW_PHASE4_TEST_RUN !== '1') {
    throw new Error(
      'Use the guarded Phase 4 test runner for integration tests',
    );
  }
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Integration tests require NODE_ENV=test');
  }

  const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error('INTEGRATION_DATABASE_URL is required');
  const parsedDatabaseUrl = parseUrl(databaseUrl, 'INTEGRATION_DATABASE_URL');
  const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
    !LOOPBACK_HOSTS.has(parsedDatabaseUrl.hostname) ||
    parsedDatabaseUrl.port !== TEST_DB_PORT ||
    parsedDatabaseUrl.username !== TEST_DB_USER ||
    !process.env.PHASE4_POSTGRES_PASSWORD ||
    parsedDatabaseUrl.password !== process.env.PHASE4_POSTGRES_PASSWORD ||
    !databaseName.startsWith(INTEGRATION_DB_PREFIX)
  ) {
    throw new Error(
      'Integration tests require the dedicated local Phase 4 PostgreSQL endpoint (127.0.0.1:55432) and an isolated ledgerflow_phase1f_integration_* database',
    );
  }

  if (
    process.env.DATABASE_URL !== undefined &&
    process.env.DATABASE_URL !== databaseUrl
  ) {
    throw new Error('DATABASE_URL must exactly match INTEGRATION_DATABASE_URL');
  }

  if (!options.redis) return { databaseUrl };

  const redisUrl = process.env.INTEGRATION_REDIS_URL;
  if (!redisUrl) throw new Error('INTEGRATION_REDIS_URL is required');
  const parsedRedisUrl = parseUrl(redisUrl, 'INTEGRATION_REDIS_URL');
  if (
    parsedRedisUrl.protocol !== 'redis:' ||
    !LOOPBACK_HOSTS.has(parsedRedisUrl.hostname) ||
    parsedRedisUrl.port !== TEST_REDIS_PORT ||
    parsedRedisUrl.username !== '' ||
    parsedRedisUrl.password !== '' ||
    !['', '/', '/0'].includes(parsedRedisUrl.pathname) ||
    parsedRedisUrl.search !== '' ||
    parsedRedisUrl.hash !== ''
  ) {
    throw new Error(
      'Background integration tests require the dedicated local Phase 4 Redis endpoint (127.0.0.1:56379, database 0)',
    );
  }

  if (
    process.env.REDIS_URL !== undefined &&
    process.env.REDIS_URL !== redisUrl
  ) {
    throw new Error('REDIS_URL must exactly match INTEGRATION_REDIS_URL');
  }

  return { databaseUrl, redisUrl };
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}
