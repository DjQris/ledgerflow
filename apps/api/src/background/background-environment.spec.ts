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
});
