import {
  redisConnection,
  validateBackgroundEnvironment,
} from './background-environment';

const databaseUrl = 'postgresql://user:password@localhost:5432/test';

describe('background environment', () => {
  it('defaults to loopback Redis for development', () => {
    expect(
      validateBackgroundEnvironment({ DATABASE_URL: databaseUrl }),
    ).toMatchObject({
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
    });
  });

  it('requires TLS for production Redis and rejects malformed URLs', () => {
    expect(() =>
      validateBackgroundEnvironment({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        REDIS_URL: 'redis://cache.example:6379',
      }),
    ).toThrow('rediss://');
    expect(() =>
      validateBackgroundEnvironment({
        DATABASE_URL: databaseUrl,
        REDIS_URL: 'redis://cache.example:6379/other',
      }),
    ).toThrow('REDIS_URL');
    expect(
      validateBackgroundEnvironment({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://cache.example:6379',
      }).REDIS_URL,
    ).toBe('rediss://cache.example:6379');
  });

  it('uses fail-fast dispatcher and reconnecting worker policies', () => {
    const dispatcher = redisConnection('redis://127.0.0.1:6379', 'dispatcher');
    const worker = redisConnection('rediss://cache.example:6379', 'worker');
    expect(dispatcher.maxRetriesPerRequest).toBe(1);
    expect(dispatcher.enableOfflineQueue).toBe(false);
    expect(worker.maxRetriesPerRequest).toBeNull();
    expect(worker.tls).toEqual({});
  });

  it('bounds job attempts, retry delay, and connection timeout', () => {
    const config = validateBackgroundEnvironment({ DATABASE_URL: databaseUrl });
    expect(config).toMatchObject({
      BACKGROUND_JOB_MAX_ATTEMPTS: 5,
      BACKGROUND_RETRY_DELAY_MS: 1_000,
      REDIS_CONNECT_TIMEOUT_MS: 2_000,
      DISPATCHER_HEALTH_PORT: 3101,
      WORKER_HEALTH_PORT: 3102,
    });
    expect(() =>
      validateBackgroundEnvironment({
        DATABASE_URL: databaseUrl,
        BACKGROUND_JOB_MAX_ATTEMPTS: 0,
      }),
    ).toThrow('BACKGROUND_JOB_MAX_ATTEMPTS');
    expect(() =>
      validateBackgroundEnvironment({
        DATABASE_URL: databaseUrl,
        BACKGROUND_RETRY_DELAY_MS: 0,
      }),
    ).toThrow('BACKGROUND_RETRY_DELAY_MS');
    expect(() =>
      validateBackgroundEnvironment({
        DATABASE_URL: databaseUrl,
        WORKER_HEALTH_PORT: 0,
      }),
    ).toThrow('WORKER_HEALTH_PORT');
  });
});
