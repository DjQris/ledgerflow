import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';

import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(60_000);

describe('Phase 2B authentication PostgreSQL HTTP integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const origin = 'http://localhost:3000';
  const signingKey = randomBytes(48).toString('hex');
  const prior = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SIGNING_KEY: process.env.AUTH_SIGNING_KEY,
    AUTH_ALLOWED_ORIGIN: process.env.AUTH_ALLOWED_ORIGIN,
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
  };

  beforeAll(async () => {
    const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error('INTEGRATION_DATABASE_URL is required');
    const name = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (!name.startsWith('ledgerflow_phase1f_integration_')) {
      throw new Error('Auth tests require an isolated integration database');
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_SIGNING_KEY = signingKey;
    process.env.AUTH_ALLOWED_ORIGIN = origin;
    process.env.AUTH_COOKIE_SECURE = 'false';

    const { AppModule } = await import('../app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
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
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const server = () => app.getHttpServer() as Server;
  const email = () => `auth-${randomUUID()}@example.com`;
  const password = 'Correct horse battery staple 2026!';
  const cookie = (response: request.Response, name: string): string => {
    const headers = response.headers['set-cookie'] as unknown as
      string[] | undefined;
    const item = headers?.find((value) => value.startsWith(`${name}=`));
    if (!item) throw new Error(`Missing ${name} cookie`);
    return item.split(';')[0];
  };
  const refreshRaw = (response: request.Response): string =>
    cookie(response, 'ledgerflow_refresh').split('=')[1];
  const accessCookie = (response: request.Response): string =>
    cookie(response, 'ledgerflow_access');
  const refreshCookie = (response: request.Response): string =>
    cookie(response, 'ledgerflow_refresh');
  const profile = (response: request.Response) =>
    response.body as {
      email: string;
      id: string;
      role: UserRole;
      status: UserStatus;
    };
  const failure = (response: request.Response) => {
    const body = response.body as { message: string; statusCode: number };
    return { message: body.message, statusCode: body.statusCode };
  };

  async function register(address = email()) {
    const response = await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: address, password })
      .expect(201);
    return { address, response };
  }

  async function login(address: string) {
    return request(server())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: address, password })
      .expect(200);
  }

  it('registers only a normalized customer, hashes the password, and rejects duplicates/role injection', async () => {
    const address = email();
    const { response } = await register(`  ${address.toUpperCase()}  `);
    const registered = profile(response);
    expect(registered).toEqual({
      email: address,
      id: registered.id,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    expect(registered.id).toMatch(/^[0-9a-f-]{36}$/);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    expect(user.passwordHash).toMatch(/^\$2[ab]\$12\$/);
    expect(await bcrypt.compare(password, user.passwordHash!)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(user.passwordHash!);
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: address.toUpperCase(), password })
      .expect(409);
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: email(), password, role: 'ADMIN' })
      .expect(400);
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: email(), password: 'a'.repeat(73) })
      .expect(400);
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: email(), password: 'short' })
      .expect(400);
  });

  it('returns generic login errors and refuses suspended provisional identities', async () => {
    const address = email();
    const unknown = await request(server())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: address, password })
      .expect(401);
    await register(address);
    const wrong = await request(server())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: address, password: 'An incorrect password 2026' })
      .expect(401);
    expect(failure(wrong)).toEqual(failure(unknown));
    await prisma.user.update({
      where: { email: address },
      data: { status: UserStatus.SUSPENDED },
    });
    const suspended = await request(server())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: address, password })
      .expect(401);
    expect(failure(suspended)).toEqual(failure(unknown));
    expect(
      await prisma.authSession.count({ where: { user: { email: address } } }),
    ).toBe(0);
  });

  it('logs in with host-only HTTP-only cookies and verifies JWT plus active DB session', async () => {
    const { address } = await register();
    const loggedIn = await login(address);
    const identity = profile(loggedIn);
    expect(identity).toEqual({
      email: address,
      id: identity.id,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    expect(identity.id).toMatch(/^[0-9a-f-]{36}$/);
    const setCookies = loggedIn.headers['set-cookie'] as unknown as string[];
    expect(setCookies).toHaveLength(2);
    for (const item of setCookies) {
      expect(item).toContain('HttpOnly');
      expect(item).toContain('SameSite=Lax');
      expect(item).toContain('Path=/');
      expect(item).not.toContain('Domain=');
    }
    const raw = refreshRaw(loggedIn);
    const hash = createHash('sha256').update(raw).digest('hex');
    const stored = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hash },
      include: { session: true },
    });
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.session.userId).toBe(identity.id);
    expect(stored.session.revokedAt).toBeNull();
    const loginAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'login_succeeded', entityId: stored.sessionId },
    });
    expect(JSON.stringify(loginAudit.metadata)).not.toContain(raw);
    expect(JSON.stringify(loginAudit.metadata)).not.toContain(
      accessCookie(loggedIn).split('=')[1],
    );
    await request(server()).get('/api/v1/auth/me').expect(401);
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', accessCookie(loggedIn))
      .expect(200, identity);
    const jwt = accessCookie(loggedIn).split('=')[1];
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', `ledgerflow_access=${jwt.slice(0, -1)}x`)
      .expect(401);
    const expired = new JwtService().sign(
      {
        sub: identity.id,
        sid: stored.sessionId,
        exp: Math.floor(Date.now() / 1000) - 1,
      },
      {
        secret: signingKey,
        algorithm: 'HS256',
        issuer: 'ledgerflow-api',
        audience: 'ledgerflow-client',
      },
    );
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', `ledgerflow_access=${expired}`)
      .expect(401);
    const missingExpiry = new JwtService().sign(
      { sub: identity.id, sid: stored.sessionId },
      {
        secret: signingKey,
        algorithm: 'HS256',
        issuer: 'ledgerflow-api',
        audience: 'ledgerflow-client',
      },
    );
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', `ledgerflow_access=${missingExpiry}`)
      .expect(401);
    const wrongAudience = new JwtService().sign(
      { sub: identity.id, sid: stored.sessionId },
      {
        secret: signingKey,
        algorithm: 'HS256',
        issuer: 'ledgerflow-api',
        audience: 'different-client',
        expiresIn: 900,
      },
    );
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', `ledgerflow_access=${wrongAudience}`)
      .expect(401);
  });

  it('rotates refresh tokens, detects reuse, and immediately revokes the session', async () => {
    const { address } = await register();
    const loggedIn = await login(address);
    const firstRaw = refreshRaw(loggedIn);
    const rotated = await request(server())
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', refreshCookie(loggedIn))
      .expect(204);
    expect(refreshRaw(rotated)).not.toBe(firstRaw);
    const first = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(firstRaw).digest('hex') },
    });
    expect(first.usedAt).not.toBeNull();
    const second = await prisma.refreshToken.findUniqueOrThrow({
      where: {
        tokenHash: createHash('sha256')
          .update(refreshRaw(rotated))
          .digest('hex'),
      },
    });
    expect(second.parentTokenId).toBe(first.id);
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', accessCookie(rotated))
      .expect(200);
    const reuse = await request(server())
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', refreshCookie(loggedIn))
      .expect(401);
    expect(
      (reuse.headers['set-cookie'] as unknown as string[]).join(' '),
    ).toContain('Expires=Thu, 01 Jan 1970');
    expect(
      (
        await prisma.authSession.findUniqueOrThrow({
          where: { id: first.sessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: {
          action: 'refresh_token_reuse_detected',
          entityId: first.sessionId,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.refreshToken.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', accessCookie(rotated))
      .expect(401);
  });

  it('serializes concurrent refresh attempts and revokes the family on losing-token reuse', async () => {
    const { address } = await register();
    const loggedIn = await login(address);
    const pending = () =>
      request(server())
        .post('/api/v1/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', refreshCookie(loggedIn));
    const results = await Promise.all([pending(), pending()]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 401]);
    const hash = createHash('sha256')
      .update(refreshRaw(loggedIn))
      .digest('hex');
    const old = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hash },
    });
    expect(
      (
        await prisma.authSession.findUniqueOrThrow({
          where: { id: old.sessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
    const successful = results.find((result) => result.status === 204)!;
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', accessCookie(successful))
      .expect(401);
  });

  it('logs out, clears cookies, and invalidates both access and refresh', async () => {
    const { address } = await register();
    const loggedIn = await login(address);
    const result = await request(server())
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', [accessCookie(loggedIn), refreshCookie(loggedIn)])
      .expect(204);
    expect(
      (result.headers['set-cookie'] as unknown as string[]).join(' '),
    ).toContain('Expires=Thu, 01 Jan 1970');
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', accessCookie(loggedIn))
      .expect(401);
    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', refreshCookie(loggedIn))
      .expect(401);
    const hash = createHash('sha256')
      .update(refreshRaw(loggedIn))
      .digest('hex');
    const token = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hash },
      include: { session: true },
    });
    expect(token.revokedAt).not.toBeNull();
    expect(token.session.revokedAt).not.toBeNull();
  });

  it('rejects foreign browser origins and missing-origin fetch metadata', async () => {
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', 'https://evil.example')
      .send({ email: email(), password })
      .expect(403);
    await request(server())
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: email(), password })
      .expect(403);
    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Sec-Fetch-Site', 'same-origin')
      .expect(403);
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });
});
