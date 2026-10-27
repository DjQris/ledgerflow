import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3001';
const screenshotDir = process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

async function waitForReadableTheme(page) {
  const expectedDark = await page.evaluate(
    () => window.localStorage.getItem('ledgerflow-theme') === 'dark',
  );
  await page.waitForFunction((expectDark) => {
    const heading = document.querySelector('h1');
    if (!heading) return false;
    if (document.documentElement.classList.contains('dark') !== expectDark)
      return false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.fillStyle = getComputedStyle(heading).color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return expectDark
      ? red > 180 && green > 180 && blue > 180
      : red < 100 && green < 100 && blue < 100;
  }, expectedDark);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const widths = [360, 390, 768, 1024, 1440];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/login', '/register']) {
      const response = await page.goto(new URL(route, baseUrl).toString());
      assert.equal(
        response?.status(),
        200,
        `${route} should load at ${width}px`,
      );
      await page.getByRole('main').waitFor({ state: 'visible' });
      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      assert.ok(
        dimensions.document <= dimensions.viewport + 1,
        `${route} overflows at ${width}px: ${dimensions.document} > ${dimensions.viewport}`,
      );
      if (screenshotDir) {
        await page.screenshot({
          path: join(screenshotDir, `${route.slice(1)}-${width}.png`),
          fullPage: true,
        });
      }
      console.log(`PASS ${width}px ${route}: no page overflow`);
    }
  }

  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(new URL('/login', baseUrl).toString());
  const email = page.getByRole('textbox', { name: 'Email' });
  const password = page.locator('#password');
  await email.focus();
  assert.equal(
    await email.evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await password.evaluate((element) => element === document.activeElement),
    true,
  );
  await page.getByRole('button', { name: 'Show password' }).click();
  assert.equal(await password.getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  assert.equal(await password.getAttribute('type'), 'password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByText('Enter a valid email address.')
    .waitFor({ state: 'visible' });
  await page.getByText('Enter your password.').waitFor({ state: 'visible' });
  assert.equal(await email.getAttribute('aria-invalid'), 'true');
  assert.equal(await password.getAttribute('aria-invalid'), 'true');
  console.log(
    'PASS login labels, keyboard focus, password visibility, and inline validation',
  );

  await page.goto(new URL('/register', baseUrl).toString());
  await page.getByLabel('Email').fill('qa@example.test');
  await page.locator('#password').fill('twelve characters');
  await page.getByLabel('Confirm password').fill('different password');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByText('Passwords do not match.').waitFor({ state: 'visible' });
  assert.equal(
    await page.getByLabel('Confirm password').getAttribute('aria-invalid'),
    'true',
  );
  console.log(
    'PASS registration confirmation validation without submitting credentials',
  );

  if (process.env.LEDGERFLOW_QA_ACCESS_COOKIE) {
    const role = process.env.LEDGERFLOW_QA_ROLE;
    assert.ok(
      ['CUSTOMER', 'OPERATIONS', 'ADMIN'].includes(role),
      'Set LEDGERFLOW_QA_ROLE with the access cookie',
    );
    await page.context().addCookies([
      {
        name: 'ledgerflow_access',
        value: process.env.LEDGERFLOW_QA_ACCESS_COOKIE,
        url: new URL('/', baseUrl).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const routes =
      role === 'CUSTOMER'
        ? ['/dashboard', '/wallets', '/transfer', '/transactions']
        : [
            '/operations',
            '/operations/transactions',
            '/operations/jobs',
            '/operations/audit',
            '/operations/reconciliation',
            ...(role === 'ADMIN' ? ['/operations/users'] : []),
          ];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        const response = await page.goto(new URL(route, baseUrl).toString());
        assert.equal(
          response?.status(),
          200,
          `${role} ${route} should load at ${width}px`,
        );
        const documentWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        assert.ok(
          documentWidth <= width + 1,
          `${route} overflows at ${width}px: ${documentWidth} > ${width}`,
        );
        if (screenshotDir && (width === 360 || width === 1440)) {
          await page.screenshot({
            path: join(
              screenshotDir,
              `${route.slice(1).replaceAll('/', '-')}-${width}.png`,
            ),
            fullPage: true,
          });
        }
        console.log(`PASS ${width}px ${role} ${route}: no page overflow`);
      }
    }

    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(new URL('/dashboard', baseUrl).toString());
    const mobileTrigger = page.getByRole('button', { name: 'Open navigation' });
    await mobileTrigger.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await page
        .getByRole('button', { name: 'Close navigation' })
        .getAttribute('aria-expanded'),
      'true',
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await page
        .getByRole('button', { name: 'Open navigation' })
        .getAttribute('aria-expanded'),
      'false',
    );
    assert.equal(
      await mobileTrigger.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    await page.keyboard.press('Enter');
    const destination = role === 'CUSTOMER' ? 'Transfer' : 'Jobs';
    await page
      .getByRole('navigation', { name: 'Mobile primary' })
      .getByRole('link', { name: destination })
      .click();
    await page.waitForURL(
      role === 'CUSTOMER' ? '**/transfer' : '**/operations/jobs',
    );
    console.log(
      'PASS mobile keyboard menu, focus restoration, and route navigation',
    );

    const themeButton = page.getByRole('button', {
      name: /Switch to (light|dark) theme/,
    });
    const wasDark = await page
      .locator('html')
      .evaluate((element) => element.classList.contains('dark'));
    await themeButton.click();
    assert.notEqual(
      await page
        .locator('html')
        .evaluate((element) => element.classList.contains('dark')),
      wasDark,
    );
    await page.reload();
    assert.notEqual(
      await page
        .locator('html')
        .evaluate((element) => element.classList.contains('dark')),
      wasDark,
    );
    await waitForReadableTheme(page);
    if (screenshotDir)
      await page.screenshot({
        path: join(screenshotDir, 'theme-toggled-360.png'),
        fullPage: true,
      });
    console.log(
      'PASS theme toggle, reload persistence, and readable heading color',
    );

    if (role === 'CUSTOMER') {
      let transferSubmitted = false;
      await page.route('**/api/customer/transfers', async (route) => {
        transferSubmitted = true;
        await route.abort();
      });
      await page.goto(new URL('/transfer', baseUrl).toString());
      const sourceWallet = page.locator('#sourceWalletId');
      await sourceWallet.waitFor({ state: 'visible' });
      assert.ok(
        Number(await sourceWallet.locator('option').count()) > 0,
        'QA customer must have an active source wallet',
      );
      const sourceId = await sourceWallet.inputValue();
      const defaultRecipient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const recipientId =
        sourceId === defaultRecipient
          ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
          : defaultRecipient;
      await page.getByLabel('Recipient wallet ID').fill(recipientId);
      await page.getByLabel('Amount').fill('0.01');
      await page.getByRole('button', { name: 'Review transfer' }).click();
      await page
        .getByRole('heading', { name: 'Review transfer' })
        .waitFor({ state: 'visible' });
      await page.getByText('₦0.01').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Confirm transfer' }).click();
      await page.getByRole('alertdialog').waitFor({ state: 'visible' });
      assert.equal(
        transferSubmitted,
        false,
        'review/confirmation QA must not send a financial write',
      );
      await page.keyboard.press('Escape');
      await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
      assert.equal(transferSubmitted, false);
      console.log(
        'PASS real API wallet data, exact transfer preview, and no financial write',
      );
    } else {
      const protectedRoute =
        role === 'OPERATIONS'
          ? '/api/operations/users'
          : '/api/customer/wallets';
      const status = await page.evaluate(
        async (route) => (await fetch(route)).status,
        protectedRoute,
      );
      assert.equal(status, 403, `${role} should be denied ${protectedRoute}`);
      console.log(`PASS ${role} BFF role denial for ${protectedRoute}`);
    }

    if (process.env.CHECK_DESIGN_SYSTEM === '1') {
      for (const width of [360, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(new URL('/design-system', baseUrl).toString());
        await waitForReadableTheme(page);
        const documentWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        assert.ok(
          documentWidth <= width + 1,
          `design-system overflows at ${width}px`,
        );
        console.log(`PASS ${width}px /design-system: no page overflow`);
      }
      await page.setViewportSize({ width: 360, height: 900 });
      await page.goto(new URL('/design-system', baseUrl).toString());
      await page.getByRole('button', { name: 'Open confirmation' }).click();
      await page.getByRole('alertdialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
      await page.getByRole('tab', { name: 'Customer' }).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page
        .getByText(
          'Operations views prioritize dense review and status scanning.',
        )
        .waitFor({ state: 'visible' });
      console.log('PASS development dialog Escape and keyboard tabs');
    }
    await page.goto(new URL('/dashboard', baseUrl).toString());
    await page.locator('details summary').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
    await page.goto(new URL('/dashboard', baseUrl).toString());
    assert.equal(
      new URL(page.url()).pathname,
      '/login',
      'protected data must be denied after logout',
    );
    console.log('PASS logout and protected-route denial');
    console.log(
      `PASS authenticated ${role} route smoke checks (data source: configured API)`,
    );
  } else {
    console.log(
      'SKIP authenticated workspace checks: no dedicated QA access cookie configured',
    );
  }
} finally {
  await browser.close();
}
