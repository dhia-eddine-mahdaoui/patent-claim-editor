import { expect, test } from '@playwright/test';
import { analyzeClaims } from '../src/domain/analysis';
import { buildDependencyTree } from '../src/domain/tree';
import { clickEndOfClaim, openDraft, tab } from './helpers';

const NOUNS = ['sensor', 'housing', 'valve', 'controller', 'bracket', 'gasket', 'circuit', 'sleeve'];

/** One independent claim plus dependent claims in several chains, all with valid references. */
function bigDocument(count: number) {
  const claims = [
    { id: 'c1', number: 1, text: 'A system comprising: a sensor; a housing; a valve; a controller; a bracket; a gasket; a circuit; and a sleeve.' },
  ];
  for (let n = 2; n <= count; n += 1) {
    const parent = n <= 4 ? 1 : n - 1 - ((n * 7) % 3);
    const noun = NOUNS[n % NOUNS.length];
    claims.push({
      id: `c${n}`,
      number: n,
      text: `The system of claim ${Math.max(1, parent)}, wherein the ${noun} is coupled to a bracket-${n} that holds the ${NOUNS[(n + 3) % NOUNS.length]}.`,
    });
  }
  return { title: 'Large claim set', spec: 'A system with a sensor, a housing and a valve.', claims };
}

test('analysis cost for 100 and 500 claims (pure domain code)', () => {
  for (const size of [100, 500]) {
    const { claims, spec } = bigDocument(size);
    const runs: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const t = performance.now();
      analyzeClaims(claims, spec);
      buildDependencyTree(claims);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    console.log(`PERF analysis+tree ${size} claims: median ${runs[7].toFixed(2)} ms, max ${runs[14].toFixed(2)} ms`);
  }
});

test('typing in a 100-claim document stays responsive', async ({ page, request }) => {
  await openDraft(page, request, bigDocument(100));
  await expect(page.locator('p.claim')).toHaveCount(100);
  await tab(page, 'Issues').click();
  await page.locator('p.claim').nth(49).scrollIntoViewIfNeeded();
  await clickEndOfClaim(page, 50);

  // Key-down to the second animation frame after it, which is when the edit has been painted.
  await page.evaluate(() => {
    const w = window as unknown as { __lat: number[] };
    w.__lat = [];
    window.addEventListener(
      'keydown',
      () => {
        const start = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => w.__lat.push(performance.now() - start)));
      },
      true,
    );
  });
  const text = ' with additional text typed to measure the latency of each keystroke.';
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(600);
  const lat = await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat);
  lat.sort((a, b) => a - b);
  const pick = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
  console.log(
    `PERF typing latency, 100 claims, ${lat.length} keystrokes: p50 ${pick(0.5).toFixed(1)} ms, p95 ${pick(0.95).toFixed(1)} ms, max ${lat[lat.length - 1].toFixed(1)} ms`,
  );
  expect(pick(0.95)).toBeLessThan(150);
});
