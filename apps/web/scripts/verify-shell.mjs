import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3001';
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
  const routes = ['/dashboard', '/operations/transactions'];

  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      const response = await page.goto(new URL(route, baseUrl).toString());
      assert.equal(
        response?.status(),
        200,
        `${route} should load at ${width}px`,
      );
      await waitForReadableTheme(page);
      const { viewport, documentWidth } = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(
        documentWidth <= viewport + 1,
        `${route} overflows at ${width}px: ${documentWidth} > ${viewport}`,
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
      console.log(`PASS ${width}px ${route}: no page overflow`);
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
  await page
    .getByRole('navigation', { name: 'Mobile primary' })
    .getByRole('link', { name: 'Jobs' })
    .click();
  await page.waitForURL('**/operations/jobs');
  assert.equal(new URL(page.url()).pathname, '/operations/jobs');
  console.log('PASS mobile keyboard menu and route navigation');

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
  if (screenshotDir) {
    await page.screenshot({
      path: join(screenshotDir, 'theme-toggled-360.png'),
      fullPage: true,
    });
  }
  console.log('PASS theme toggle and reload persistence');

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
    const response = await page.goto(
      new URL('/design-system', baseUrl).toString(),
    );
    assert.equal(response?.status(), 200, 'development showcase should load');
    await waitForReadableTheme(page);
    if (screenshotDir) {
      await page.screenshot({
        path: join(screenshotDir, 'design-system-360.png'),
        fullPage: true,
      });
    }
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
    console.log('PASS development dialog Escape and tabs');
  }
} finally {
  await browser.close();
}
