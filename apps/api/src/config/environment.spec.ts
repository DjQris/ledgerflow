import { validateEnvironment } from './environment';

const databaseUrl = 'postgresql://user:password@localhost:5432/test';
const signingKey = 'a'.repeat(64);

describe('authentication environment validation', () => {
  it('uses the specified lifetimes and work factor defaults', () => {
    const config = validateEnvironment({ DATABASE_URL: databaseUrl });
    expect(config.AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.AUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(604800);
    expect(config.AUTH_BCRYPT_ROUNDS).toBe(12);
    expect(config.AUTH_SIGNING_KEY).toBeNull();
    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
    expect(config.REQUEST_BODY_LIMIT_BYTES).toBe(16_384);
  });

  it('requires a signing key, HTTPS origin, and secure cookies in production', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
      }),
    ).toThrow('AUTH_SIGNING_KEY');
    expect(() =>
      validateEnvironment({
        AUTH_SIGNING_KEY: signingKey,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
      }),
    ).toThrow('AUTH_ALLOWED_ORIGIN');
    expect(() =>
      validateEnvironment({
        AUTH_ALLOWED_ORIGIN: 'https://ledgerflow.example',
        AUTH_COOKIE_SECURE: false,
        AUTH_SIGNING_KEY: signingKey,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
      }),
    ).toThrow('AUTH_COOKIE_SECURE');
    const valid = validateEnvironment({
      AUTH_ALLOWED_ORIGIN: 'https://ledgerflow.example',
      AUTH_SIGNING_KEY: signingKey,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://cache.example:6379',
    });
    expect(valid.AUTH_COOKIE_SECURE).toBe(true);
  });

  it('rejects weak or malformed auth configuration', () => {
    expect(() =>
      validateEnvironment({
        AUTH_SIGNING_KEY: 'short',
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('AUTH_SIGNING_KEY');
    expect(() =>
      validateEnvironment({
        AUTH_BCRYPT_ROUNDS: 11,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('AUTH_BCRYPT_ROUNDS');
    expect(() =>
      validateEnvironment({
        AUTH_ALLOWED_ORIGIN: 'https://ledgerflow.example/path',
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('AUTH_ALLOWED_ORIGIN');
    expect(() =>
      validateEnvironment({
        AUTH_ALLOWED_ORIGIN: 'https://ledgerflow.example',
        AUTH_COOKIE_SECURE: false,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('AUTH_COOKIE_SECURE');
  });

  it('requires exact trusted CORS origins and a bounded body limit', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        CORS_ALLOWED_ORIGINS: 'https://app.example/path',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        CORS_ALLOWED_ORIGINS: '*',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        REQUEST_BODY_LIMIT_BYTES: 20_000_000,
      }),
    ).toThrow('REQUEST_BODY_LIMIT_BYTES');
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        AUTH_SIGNING_KEY: signingKey,
        AUTH_ALLOWED_ORIGIN: 'https://app.example',
        CORS_ALLOWED_ORIGINS: 'https://app.example,http://localhost:3000',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
    const valid = validateEnvironment({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      AUTH_SIGNING_KEY: signingKey,
      AUTH_ALLOWED_ORIGIN: 'https://app.example',
      CORS_ALLOWED_ORIGINS: 'https://app.example, https://admin.example',
      REDIS_URL: 'rediss://cache.example:6379',
    });
    expect(valid.CORS_ALLOWED_ORIGINS).toEqual([
      'https://app.example',
      'https://admin.example',
    ]);
  });
});
