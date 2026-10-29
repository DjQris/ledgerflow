import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const webUrl = new URL(process.env.WEB_BASE_URL ?? 'http://127.0.0.1:43101');
const apiUrl = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:43000/api/v1');
assert.equal(webUrl.hostname, '127.0.0.1', 'E2E web host must be loopback');
assert.equal(webUrl.port, '43101', 'E2E web port must be the dedicated Phase 4 port');
assert.equal(apiUrl.hostname, '127.0.0.1', 'E2E API host must be loopback');
assert.equal(apiUrl.port, '43000', 'E2E API port must be the dedicated Phase 4 port');
assert.equal(process.env.LEDGERFLOW_PHASE4_TEST_RUN, '1');
assert.equal(process.env.PHASE4_E2E_FIXTURES, '1');

const chromiumPath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const failureDir = process.env.SCREENSHOT_DIR;
if (failureDir) await mkdir(failureDir, { recursive: true });
const fixturePath = 'apps/api/dist/database/phase4-e2e-fixture.js';
function fixture(action, id) {
  const args = [fixturePath, action];
  if (id) args.push(id);
  return execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function fixtureCredentials() {
  const output = fixture('operations-user');
  return JSON.parse(output);
}

const runId = randomUUID();
const password = `Phase4-${randomUUID()}-e2e`;
const operations = fixtureCredentials();
const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const contexts = [];
let failed = false;

async function newContext(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  contexts.push({ context, label });
  return context;
}

async function registerAndLogin(page, email) {
  await page.goto(new URL('/register', webUrl).toString());
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.waitForURL('**/login?registered=1');
  await page.getByLabel('Email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
}

async function createWallet(page) {
  const result = await page.evaluate(async (apiBase) => {
    const csrfResponse = await fetch(`${apiBase}/auth/csrf`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const csrfBody = await csrfResponse.json();
    if (!csrfResponse.ok || typeof csrfBody.csrfToken !== 'string') {
      return { status: csrfResponse.status, error: 'CSRF token unavailable' };
    }
    const response = await fetch(`${apiBase}/wallets`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfBody.csrfToken,
      },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  }, apiUrl.toString().replace(/\/$/, ''));
  assert.equal(result.status, 201, `wallet creation failed with ${result.status}`);
  assert.equal(result.body.currency, 'NGN');
  assert.equal(typeof result.body.balanceMinor, 'string');
  return result.body;
}

try {
  const operationsContext = await newContext('operations');
  const operationsPage = await operationsContext.newPage();
  const customerContext = await newContext('customer-a');
  const customerPage = await customerContext.newPage();
  const recipientContext = await newContext('customer-b');
  const recipientPage = await recipientContext.newPage();

  await registerAndLogin(customerPage, `phase4-a-${runId}@example.test`);
  const sourceWallet = await createWallet(customerPage);
  fixture('fund-wallet', sourceWallet.id);
  await customerPage.goto(new URL('/dashboard', webUrl).toString());
  await customerPage.getByText(sourceWallet.id, { exact: true }).waitFor();
  console.log('PASS customer registration, login, synthetic funding, and wallet display');

  await registerAndLogin(recipientPage, `phase4-b-${runId}@example.test`);
  const recipientWallet = await createWallet(recipientPage);
  console.log('PASS second customer registration and recipient wallet provisioning');

  const foreignWalletResponse = await customerPage.evaluate(async (walletId) => {
    const response = await fetch(`/api/customer/wallets/${walletId}/transactions?page=1&pageSize=20`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return response.status;
  }, recipientWallet.id);
  assert.ok([403, 404].includes(foreignWalletResponse), `foreign wallet read returned ${foreignWalletResponse}`);

  const csrfRejected = await customerPage.evaluate(async (apiBase, walletId) => {
    const response = await fetch(`${apiBase}/transfers`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ sourceWalletId: walletId, destinationWalletId: walletId, amountMinor: '1' }),
    });
    return response.status;
  }, apiUrl.toString().replace(/\/$/, ''), sourceWallet.id);
  assert.equal(csrfRejected, 403, 'a direct cookie-authenticated write without CSRF must be rejected');

  const foreignSourceResponse = await customerPage.evaluate(async (intent) => {
    const response = await fetch('/api/customer/transfers', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(intent),
    });
    return response.status;
  }, {
    sourceWalletId: recipientWallet.id,
    destinationWalletId: sourceWallet.id,
    amountMinor: '100',
  });
  assert.ok([403, 404].includes(foreignSourceResponse), `foreign-source transfer returned ${foreignSourceResponse}`);
  console.log('PASS server rejects CSRF-free writes and customer A cannot read/use customer B wallet');

  let transferResult = null;
  customerPage.on('response', async (response) => {
    if (response.url().endsWith('/api/customer/transfers') && response.status() === 201) {
      try { transferResult = await response.json(); } catch { /* reported by later assertions */ }
    }
  });
  let firstKey = null;
  let retryKey = null;
  await customerPage.route('**/api/customer/transfers', async (route) => {
    const request = route.request();
    if (firstKey === null) {
      firstKey = await request.headerValue('idempotency-key');
      await route.abort('connectionreset');
      return;
    }
    retryKey = await request.headerValue('idempotency-key');
    await route.continue();
  });
  await customerPage.goto(new URL('/transfer', webUrl).toString());
  await customerPage.getByLabel('Recipient wallet ID').fill(recipientWallet.id);
  await customerPage.getByLabel('Amount').fill('100.00');
  await customerPage.getByRole('button', { name: 'Review transfer' }).click();
  await customerPage.getByRole('button', { name: 'Confirm transfer' }).click();
  await customerPage.getByRole('button', { name: 'Send transfer' }).click();
  await customerPage.getByRole('heading', { name: 'Outcome not confirmed' }).waitFor();
  await customerPage.getByRole('button', { name: 'Verify / retry this transfer safely' }).click();
  await customerPage.getByRole('heading', { name: 'Transfer successful' }).waitFor();
  assert.ok(firstKey && retryKey, 'both original and retry idempotency keys must be observed');
  assert.equal(retryKey, firstKey, 'unknown-outcome retry must reuse the original idempotency key');
  assert.equal(transferResult?.amountMinor, '10000');
  assert.equal(transferResult?.sourceWalletId, sourceWallet.id);
  assert.equal(transferResult?.destinationWalletId, recipientWallet.id);
  console.log('PASS transfer confirmation and network-uncertain retry with the same idempotency key');

  fixture('record-audit-job', transferResult.transferId);
  await customerPage.goto(new URL('/transactions', webUrl).toString());
  await customerPage.getByText('COMPLETED', { exact: true }).first().waitFor();
  console.log('PASS real transaction is visible in customer history');

  await operationsPage.goto(new URL('/login', webUrl).toString());
  await operationsPage.getByLabel('Email').fill(operations.email);
  await operationsPage.locator('#password').fill(operations.password);
  await operationsPage.getByRole('button', { name: 'Sign in' }).click();
  await operationsPage.waitForURL('**/operations');
  await operationsPage.goto(new URL('/operations/audit', webUrl).toString());
  await operationsPage.getByRole('heading', { name: 'Audit events' }).waitFor();
  await operationsPage.getByText('transfer_completed', { exact: true }).first().waitFor();
  await operationsPage.goto(new URL('/operations/jobs', webUrl).toString());
  await operationsPage.getByText('PROCESSING_FAILED', { exact: true }).first().waitFor();
  await operationsPage.getByRole('link', { name: /Inspect/ }).first().click();
  await operationsPage.getByText('Failure record', { exact: true }).waitFor();
  await operationsPage.getByText('PROCESSING_FAILED', { exact: true }).first().waitFor();
  console.log('PASS authorized operations user inspects the synthetic failed job and real audit event');

  const refreshCookiesBefore = await customerContext.cookies(webUrl.toString());
  const previousRefresh = refreshCookiesBefore.find((cookie) => cookie.name === 'ledgerflow_refresh')?.value;
  assert.ok(previousRefresh, 'refresh cookie must be present before expiry');
  await customerPage.waitForTimeout(61_000);
  const refreshResult = await customerPage.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { origin: window.location.origin },
    });
    return response.status;
  });
  assert.equal(refreshResult, 204, 'refresh endpoint should renew an expired access session');
  const refreshCookiesAfter = await customerContext.cookies(webUrl.toString());
  const nextRefresh = refreshCookiesAfter.find((cookie) => cookie.name === 'ledgerflow_refresh')?.value;
  assert.ok(nextRefresh && nextRefresh !== previousRefresh, 'refresh token must rotate');
  await customerPage.goto(new URL('/dashboard', webUrl).toString());
  await customerPage.getByRole('heading', { name: 'Overview' }).waitFor();
  await customerPage.locator('summary').first().click();
  await customerPage.getByRole('button', { name: 'Sign out' }).click();
  await customerPage.waitForURL('**/login');
  await customerPage.goto(new URL('/dashboard', webUrl).toString());
  await customerPage.waitForURL('**/login**');
  console.log('PASS expired access refresh rotation and logout revocation');
} catch (error) {
  failed = true;
  if (failureDir) {
    for (const { context, label } of contexts) {
      const page = context.pages().at(-1);
      if (!page) continue;
      await page.screenshot({ path: join(failureDir, `${label}-failure.png`), fullPage: true }).catch(() => {});
    }
  }
  throw error;
} finally {
  for (const { context, label } of contexts) {
    if (failed && failureDir) {
      await context.tracing.stop({ path: join(failureDir, `${label}-failure.zip`) }).catch(() => {});
    } else {
      await context.tracing.stop().catch(() => {});
    }
    await context.close();
  }
  await browser.close();
}
