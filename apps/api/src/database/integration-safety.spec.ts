import { requirePhase4IntegrationEnvironment } from './integration-safety';

const envKeys = [
  'DATABASE_URL',
  'INTEGRATION_DATABASE_URL',
  'INTEGRATION_REDIS_URL',
  'LEDGERFLOW_PHASE4_TEST_RUN',
  'NODE_ENV',
  'PHASE4_POSTGRES_PASSWORD',
  'REDIS_URL',
] as const;

describe('Phase 4 integration environment guard', () => {
  const original = new Map(envKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.LEDGERFLOW_PHASE4_TEST_RUN = '1';
    process.env.NODE_ENV = 'test';
    process.env.PHASE4_POSTGRES_PASSWORD = 'phase4-test-credential';
    const integrationUrl = new URL(
      'postgresql://ledgerflow_phase4_test@127.0.0.1:55432/ledgerflow_phase1f_integration_phase4?schema=public',
    );
    integrationUrl.password = process.env.PHASE4_POSTGRES_PASSWORD;
    process.env.INTEGRATION_DATABASE_URL = integrationUrl.toString();
    process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
    process.env.INTEGRATION_REDIS_URL = 'redis://127.0.0.1:56379';
    process.env.REDIS_URL = process.env.INTEGRATION_REDIS_URL;
  });

  afterAll(() => {
    for (const key of envKeys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('accepts only the Phase 4 local PostgreSQL and Redis endpoints', () => {
    expect(requirePhase4IntegrationEnvironment({ redis: true })).toEqual({
      databaseUrl: process.env.INTEGRATION_DATABASE_URL,
      redisUrl: process.env.INTEGRATION_REDIS_URL,
    });
  });

  it.each([
    [
      'database host',
      'INTEGRATION_DATABASE_URL',
      (url: URL) => (url.hostname = 'db.example'),
    ],
    [
      'database port',
      'INTEGRATION_DATABASE_URL',
      (url: URL) => (url.port = '5432'),
    ],
    [
      'database name',
      'INTEGRATION_DATABASE_URL',
      (url: URL) => (url.pathname = '/ledgerflow'),
    ],
    [
      'database user',
      'INTEGRATION_DATABASE_URL',
      (url: URL) => (url.username = 'ledgerflow'),
    ],
    [
      'database credential',
      'INTEGRATION_DATABASE_URL',
      (url: URL) => (url.password = 'other-secret'),
    ],
    [
      'runtime database mismatch',
      'DATABASE_URL',
      (url: URL) => (url.pathname = '/other'),
    ],
  ])('rejects an unsafe %s', (_name, key, change) => {
    const current = process.env[key];
    const changed = new URL(current ?? 'http://invalid');
    (change as (url: URL) => void)(changed);
    process.env[key] = changed.toString();
    expect(() => requirePhase4IntegrationEnvironment()).toThrow();
  });

  it('requires explicit test opt-in and NODE_ENV=test', () => {
    process.env.LEDGERFLOW_PHASE4_TEST_RUN = '0';
    expect(() => requirePhase4IntegrationEnvironment()).toThrow(
      'Use the guarded Phase 4 test runner',
    );
    process.env.LEDGERFLOW_PHASE4_TEST_RUN = '1';
    process.env.NODE_ENV = 'development';
    expect(() => requirePhase4IntegrationEnvironment()).toThrow(
      'NODE_ENV=test',
    );
  });

  it.each([
    ['default development Redis port', 'redis://127.0.0.1:6379'],
    ['remote Redis host', 'redis://cache.example:56379'],
    ['TLS Redis', 'rediss://127.0.0.1:56379'],
  ])('rejects %s for background suites', (_name, redisUrl) => {
    process.env.INTEGRATION_REDIS_URL = redisUrl;
    process.env.REDIS_URL = redisUrl;
    expect(() => requirePhase4IntegrationEnvironment({ redis: true })).toThrow(
      'dedicated local Phase 4 Redis endpoint',
    );
  });
});
