import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';

import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { configureHttpSecurity } from '../common/http-security';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(60_000);

describe('Phase 2B authentication PostgreSQL HTTP integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
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
    app = module.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix('api/v1');
    configureHttpSecurity(app, {
      CORS_ALLOWED_ORIGINS: [origin],
      NODE_ENV: 'test',
      REQUEST_BODY_LIMIT_BYTES: 16_384,
    });
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
    ledger = app.get(LedgerService);
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
  const csrfToken = (response: request.Response): string => {
    const token: unknown = response.headers['x-csrf-token'];
    if (typeof token !== 'string') throw new Error('Missing CSRF token');
    return token;
  };
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
      .set('X-CSRF-Token', csrfToken(loggedIn))
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
      .set('X-CSRF-Token', csrfToken(loggedIn))
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
        .set('Cookie', refreshCookie(loggedIn))
        .set('X-CSRF-Token', csrfToken(loggedIn));
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
      .set('X-CSRF-Token', csrfToken(loggedIn))
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
      .set('X-CSRF-Token', csrfToken(loggedIn))
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

  it('enforces customer wallet ownership and permits only owned-source transfers', async () => {
    const first = await register();
    const second = await register();
    const a = await login(first.address);
    const b = await login(second.address);
    const firstWallet = await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(a))
      .set('X-CSRF-Token', csrfToken(a))
      .send({})
      .expect(201);
    const secondWallet = await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(b))
      .set('X-CSRF-Token', csrfToken(b))
      .send({})
      .expect(201);
    const aId = (firstWallet.body as { id: string }).id;
    const bId = (secondWallet.body as { id: string }).id;
    await request(server()).get('/api/v1/wallets').expect(401);
    await request(server()).post('/api/v1/transfers').send({}).expect(401);
    await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(a))
      .set('X-CSRF-Token', csrfToken(a))
      .send({ ownerId: profile(b).id })
      .expect(400);
    const ownList = await request(server())
      .get('/api/v1/wallets')
      .set('Cookie', accessCookie(a))
      .expect(200);
    expect(
      (ownList.body as Array<{ id: string }>).map((wallet) => wallet.id),
    ).toContain(aId);
    expect(
      (ownList.body as Array<{ id: string }>).map((wallet) => wallet.id),
    ).not.toContain(bId);
    await request(server())
      .get(`/api/v1/wallets/${bId}`)
      .set('Cookie', accessCookie(a))
      .expect(403);
    await request(server())
      .get(`/api/v1/wallets/${bId}/transactions`)
      .set('Cookie', accessCookie(a))
      .expect(403);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: 'access_denied',
          actorId: profile(a).id,
          entityId: bId,
        },
      }),
    ).toBe(2);
    await ledger.postDevelopmentOpeningFunding({
      amountMinor: 1000n,
      externalReference: `phase2c:${randomUUID()}`,
      walletId: aId,
    });
    const body = {
      sourceWalletId: aId,
      destinationWalletId: bId,
      amountMinor: '100',
    };
    await request(server())
      .post('/api/v1/transfers')
      .set('Cookie', accessCookie(b))
      .set('X-CSRF-Token', csrfToken(b))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(403);
    await request(server())
      .post('/api/v1/transfers')
      .set('Cookie', accessCookie(a))
      .set('X-CSRF-Token', csrfToken(a))
      .set('Idempotency-Key', randomUUID())
      .set('X-Simulated-Actor', 'test-someone-else')
      .send(body)
      .expect(201);
    await request(server())
      .post('/api/v1/transfers')
      .set('Cookie', accessCookie(a))
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrfToken(a))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(403);
    const history = await request(server())
      .get(`/api/v1/wallets/${aId}/transactions`)
      .set('Cookie', accessCookie(a))
      .expect(200);
    expect(
      (history.body as { pagination: { total: number } }).pagination.total,
    ).toBeGreaterThan(0);
    const bTransfers = await request(server())
      .get('/api/v1/transfers')
      .set('Cookie', accessCookie(b))
      .expect(200);
    expect(bTransfers.body).toEqual([]);
    await prisma.user.update({
      where: { id: profile(a).id },
      data: { status: UserStatus.SUSPENDED },
    });
    await request(server())
      .post('/api/v1/transfers')
      .set('Cookie', accessCookie(a))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(401);
  });

  it('separates operations reads from writes and audits administrative changes', async () => {
    const adminRegistration = await register();
    const operationsRegistration = await register();
    const customerRegistration = await register();
    const adminId = (adminRegistration.response.body as { id: string }).id;
    const operationsId = (
      operationsRegistration.response.body as { id: string }
    ).id;
    const customerId = (customerRegistration.response.body as { id: string })
      .id;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: UserRole.ADMIN },
    });
    await prisma.user.update({
      where: { id: operationsId },
      data: { role: UserRole.OPERATIONS },
    });
    const admin = await login(adminRegistration.address);
    const operations = await login(operationsRegistration.address);
    const customer = await login(customerRegistration.address);
    await request(server())
      .get('/api/v1/audit-events')
      .set('Cookie', accessCookie(customer))
      .expect(403);
    await request(server())
      .get('/api/v1/audit-events')
      .set('Cookie', accessCookie(operations))
      .expect(200);
    await request(server())
      .get('/api/v1/wallets')
      .set('Cookie', accessCookie(operations))
      .expect(200);
    await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(operations))
      .set('X-CSRF-Token', csrfToken(operations))
      .send({})
      .expect(403);
    await request(server())
      .post('/api/v1/transfers')
      .set('Cookie', accessCookie(operations))
      .set('X-CSRF-Token', csrfToken(operations))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
    await request(server())
      .get('/api/v1/admin/users')
      .set('Cookie', accessCookie(operations))
      .expect(403);
    await request(server())
      .get('/api/v1/admin/users')
      .set('Cookie', accessCookie(admin))
      .expect(200);
    await request(server())
      .post('/api/v1/transfers')
      .set('Cookie', accessCookie(admin))
      .set('X-CSRF-Token', csrfToken(admin))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
    const simulatedWallet = await request(server())
      .post('/api/v1/wallets/simulated')
      .set('Cookie', accessCookie(admin))
      .set('X-CSRF-Token', csrfToken(admin))
      .send({ ownerReference: `test-phase2c-${randomUUID()}` })
      .expect(201);
    const provisional = await prisma.wallet.findUniqueOrThrow({
      where: { id: (simulatedWallet.body as { id: string }).id },
      include: { user: true },
    });
    expect(provisional.user.status).toBe(UserStatus.SUSPENDED);
    await request(server())
      .patch(`/api/v1/admin/users/${adminId}/role`)
      .set('Cookie', accessCookie(admin))
      .set('X-CSRF-Token', csrfToken(admin))
      .send({ role: UserRole.CUSTOMER })
      .expect(403);
    await request(server())
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Cookie', accessCookie(admin))
      .set('X-CSRF-Token', csrfToken(admin))
      .send({ role: UserRole.OPERATIONS })
      .expect(200);
    await request(server())
      .get('/api/v1/audit-events')
      .set('Cookie', accessCookie(customer))
      .expect(200);
    await request(server())
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Cookie', accessCookie(admin))
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrfToken(admin))
      .send({ role: UserRole.ADMIN })
      .expect(403);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'account_role_changed', entityId: customerId },
      }),
    ).toBe(1);
    await request(server())
      .patch(`/api/v1/admin/users/${customerId}/status`)
      .set('Cookie', accessCookie(admin))
      .set('X-CSRF-Token', csrfToken(admin))
      .send({ status: UserStatus.SUSPENDED })
      .expect(200);
    await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', accessCookie(customer))
      .expect(401);
    await request(server())
      .patch(`/api/v1/admin/users/${customerId}/status`)
      .set('Cookie', accessCookie(admin))
      .set('X-CSRF-Token', csrfToken(admin))
      .send({ status: UserStatus.ACTIVE })
      .expect(200);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'account_suspended', entityId: customerId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'account_reactivated', entityId: customerId },
      }),
    ).toBe(1);
  });

  it('enforces session-bound CSRF tokens and exposes them safely for clients', async () => {
    const first = await register();
    const second = await register();
    const a = await login(first.address);
    const b = await login(second.address);
    const fetched = await request(server())
      .get('/api/v1/auth/csrf')
      .set('Cookie', accessCookie(a))
      .expect(200);
    const issued = (fetched.body as { csrfToken: string }).csrfToken;
    expect(issued).toMatch(/^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/);
    await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(a))
      .send({})
      .expect(403);
    await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(a))
      .set('X-CSRF-Token', csrfToken(b))
      .send({})
      .expect(403);
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', [accessCookie(a), refreshCookie(a)])
      .expect(403);
    await request(server())
      .post('/api/v1/wallets')
      .set('Cookie', accessCookie(a))
      .set('X-CSRF-Token', issued)
      .send({})
      .expect(201);
  });

  it('sets security headers, exact credentialed CORS, and safe body limits', async () => {
    const health = await request(server()).get('/api/v1/health').expect(200);
    const readiness = await request(server())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(readiness.body).toMatchObject({ status: 'ok' });
    const query = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('private database connection detail'));
    try {
      const unready = await request(server())
        .get('/api/v1/health/ready')
        .expect(503);
      expect(unready.body).toMatchObject({ status: 'unready' });
      expect(JSON.stringify(unready.body)).not.toContain(
        'private database connection detail',
      );
    } finally {
      query.mockRestore();
    }
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['strict-transport-security']).toBeUndefined();
    expect(health.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const trusted = await request(server())
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(trusted.headers['access-control-allow-origin']).toBe(origin);
    expect(trusted.headers['access-control-allow-credentials']).toBe('true');
    const untrusted = await request(server())
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: email(), password, role: 'ADMIN' })
      .expect(400);
    const oversized = await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: email(), password: 'a'.repeat(17_000) })
      .expect(413);
    expect(JSON.stringify(oversized.body)).not.toContain('stack');
    await request(server())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
  });

  it('throttles repeated login attempts for one account', async () => {
    const address = email();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await request(server())
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: address, password });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });
});
