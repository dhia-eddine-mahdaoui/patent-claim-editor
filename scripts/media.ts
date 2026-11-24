/**
 * Records the README media with Playwright against the built app:
 *   tsx scripts/media.ts screenshots   -> docs/screenshots/*.png
 *   tsx scripts/media.ts demo          -> .tmp/demo.webm (scripts/encode-gif.sh turns it into docs/demo.gif)
 * It starts its own in-memory API server, so nothing else needs to be running. Run `npm run build` first.
 */
import { mkdirSync, renameSync } from 'node:fs';
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { buildApp } from '../server/app';

const PORT = 4392;
const BASE = `http://localhost:${PORT}`;
const mode = process.argv[2];

const CURSOR = `
(() => {
  const dot = document.createElement('div');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = 'position:fixed;z-index:99999;left:0;top:0;width:18px;height:18px;margin:-3px 0 0 -3px;pointer-events:none;' +
    'background:rgba(20,20,30,.85);border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4);transition:transform .08s;';
  const add = () => document.body && document.body.appendChild(dot);
  document.body ? add() : addEventListener('DOMContentLoaded', add);
  addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
  addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
})();
`;

async function seed(): Promise<string> {
  const response = await fetch(`${BASE}/api/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return ((await response.json()) as { id: string }).id;
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const claim = (page: Page, n: number) => page.locator('p.claim').nth(n - 1);

async function open(page: Page, id: string) {
  await page.goto(`${BASE}/?draft=${id}`);
  await page.locator('p.claim').first().waitFor();
}

async function glide(page: Page, target: Locator, click = true) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox().catch(async (error) => {
    await page.screenshot({ path: '.tmp/fail.png' });
    throw error;
  });
  if (!box) throw new Error('target not visible');
  await page.mouse.move(box.x + Math.min(box.width / 2, 90), box.y + box.height / 2, { steps: 22 });
  await page.waitForTimeout(160);
  if (click) await page.mouse.click(box.x + Math.min(box.width / 2, 90), box.y + box.height / 2);
}

async function screenshots() {
  mkdirSync('docs/screenshots', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
  const shoot = async (name: string, setup: (page: Page, id: string) => Promise<void>, opts: { dark?: boolean; width?: number; height?: number } = {}) => {
    const context = await browser.newContext({
      viewport: { width: opts.width ?? 1600, height: opts.height ?? 1000 },
      colorScheme: opts.dark ? 'dark' : 'light',
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const id = await seed();
    await open(page, id);
    await setup(page, id);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
    await context.close();
    console.log('wrote', name);
  };
  const settle = (page: Page) => page.locator('.stream-status').filter({ hasText: 'streamed' }).waitFor().catch(() => undefined);

  await shoot('editor-overview', async (page) => {
    await tab(page, 'Issues').click();
    await page.waitForTimeout(1500);
  });

  await shoot('suggestion-diff', async (page) => {
    await tab(page, 'Suggestions').click();
    await settle(page);
    await page.locator('.suggestion').nth(2).getByRole('button', { name: /Show in editor/ }).click();
    await page.waitForTimeout(600);
  });

  await shoot('spec-support', async (page) => {
    await tab(page, 'Support').click();
    await page.locator('.term-row.missing').first().click();
    await page.waitForTimeout(700);
  });

  await shoot('version-history', async (page) => {
    await tab(page, 'History').click();
    await page.getByLabel('Version label').fill('Before antecedent cleanup');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500);
    await tab(page, 'Suggestions').click();
    await settle(page);
    await page.getByRole('button', { name: /^Accept: Use "a" to introduce "the processor"/ }).click();
    await page.getByRole('button', { name: /^Accept: Use "a" to introduce "the sensor"/ }).click();
    await page.waitForTimeout(800);
    await tab(page, 'History').click();
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  });

  await shoot('version-diff', async (page) => {
    await tab(page, 'History').click();
    await page.getByLabel('Version label').fill('Before antecedent cleanup');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500);
    await tab(page, 'Suggestions').click();
    await settle(page);
    await page.getByRole('button', { name: /^Accept: Use "a" to introduce "the processor"/ }).click();
    await page.getByRole('button', { name: /^Accept: Use "a" to introduce "the sensor"/ }).click();
    await page.waitForTimeout(800);
    await tab(page, 'History').click();
    await page.getByRole('list', { name: 'Versions' }).getByText('Before antecedent cleanup').click();
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  });

  await shoot(
    'dark-mode',
    async (page) => {
      await tab(page, 'Suggestions').click();
      await settle(page);
      await page.waitForTimeout(500);
    },
    { dark: true },
  );

  await browser.close();
}

async function demo() {
  mkdirSync('.tmp', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 780 },
    colorScheme: 'light',
    recordVideo: { dir: '.tmp/video', size: { width: 1280, height: 780 } },
  });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  try {
    await runDemo(page, context);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close();
  }
  const video = page.video();
  const path = video ? await video.path() : null;
  if (!path) throw new Error('no video was recorded');
  renameSync(path, '.tmp/demo.webm');
  console.log('wrote .tmp/demo.webm');
}

async function runDemo(page: Page, context: BrowserContext) {
  void context;
  const id = await seed();
  const pause = (ms: number) => page.waitForTimeout(ms);

  page.setDefaultTimeout(10000);
  await open(page, id);
  await pause(1100);

  // 1. Type a new dependent claim: the unsupported reference is marked inline and the tree grows.
  await glide(page, claim(page, 8));
  await page.keyboard.press('Control+End');
  await pause(200);
  await page.keyboard.press('Enter');
  await pause(200);
  await page.keyboard.type('The method of claim 8, wherein the gasket is loose.', { delay: 36 });
  await pause(1100);

  // 2. Suggestions stream in; the active one is previewed inline in the claim.
  await glide(page, tab(page, 'Suggestions'));
  await pause(2000);
  const card = page.locator('.suggestion', { hasText: 'the gasket' });
  await glide(page, card.locator('.suggestion-main'));
  await pause(1000);

  // 3. Accept it: the claim changes and the issue clears.
  await glide(page, card.getByRole('button', { name: /^Accept/ }));
  await pause(1300);

  // 4. Description support: unsupported terms are listed; fix them by editing the description.
  await glide(page, tab(page, 'Support'));
  await pause(1000);
  await glide(page, page.locator('.term-row.missing').first());
  await pause(1000);
  await glide(page, page.getByRole('textbox', { name: 'Description' }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nThe baseline value is kept in a memory. A gasket seals the housing.', { delay: 26 });
  await pause(1200);

  // 5. Save a version.
  await glide(page, tab(page, 'History'));
  await pause(300);
  await glide(page, page.getByLabel('Version label'));
  await page.keyboard.type('Added claim 9', { delay: 45 });
  await page.keyboard.press('Enter');
  await pause(1500);

}

const app = buildApp({ dataFile: null, staticDir: 'dist', suggestDelayMs: mode === 'demo' ? 170 : 60 });
await app.listen({ port: PORT, host: 'localhost' });
try {
  if (mode === 'screenshots') await screenshots();
  else if (mode === 'demo') await demo();
  else throw new Error('usage: tsx scripts/media.ts screenshots|demo');
} finally {
  await app.close();
}
