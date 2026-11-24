import { expect, test } from '@playwright/test';
import { claim, clickEndOfClaim, openDraft, tab } from './helpers';

test('opens the sample with inline issue marks and a dependency tree', async ({ page, request }) => {
  await openDraft(page, request);
  await expect(page.locator('p.claim')).toHaveCount(8);
  await expect(page.locator('.hl-error').first()).toBeVisible();
  await expect(page.locator('.hl-warning').first()).toBeVisible();
  await expect(page.locator('.hl-spec').first()).toBeVisible();
  await expect(page.locator('.chips')).toContainText('1 error');
  await expect(page.locator('.tree-row')).toHaveCount(8);
  await expect(page.locator('.save-state')).toContainText('Saved');
});

test('Enter starts the next numbered claim and the tree and issues update live', async ({ page, request }) => {
  await openDraft(page, request);
  await clickEndOfClaim(page, 8);
  await page.keyboard.press('Enter');
  await expect(claim(page, 9)).toContainText('9.');
  await page.keyboard.type('The method of claim 8, wherein the gasket is loose.');
  await expect(page.locator('.tree-row')).toHaveCount(9);
  await tab(page, 'Issues').click();
  await expect(page.getByRole('list', { name: 'Issues' })).toContainText('"the gasket" has no antecedent basis');
  await expect(claim(page, 9).locator('.hl-warning')).toHaveText('the gasket');
});

test('removing a claim creates a numbering gap that one click fixes', async ({ page, request }) => {
  await openDraft(page, request);
  await expect(page.getByRole('list', { name: 'Issues' })).toContainText('Refers to claim 8, which is not an earlier claim');
  await claim(page, 2).click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(page.locator('p.claim')).toHaveCount(7);
  await expect(page.getByRole('list', { name: 'Issues' })).toContainText('Numbering jumps from 1 to 3');
  await page.getByRole('button', { name: /Fix numbering/ }).click();
  await expect(claim(page, 7)).toContainText('7.');
  await expect(page.getByRole('list', { name: 'Issues' })).not.toContainText('Numbering jumps');
});

test('suggestions stream in progressively and accepting one clears its issue', async ({ page, request }) => {
  await openDraft(page, request);
  await tab(page, 'Suggestions').click();
  const cards = page.locator('.suggestion');
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.stream-status')).toContainText('streamed from the server');

  await expect(claim(page, 3).locator('.sug-active')).toHaveText('the');
  await page.getByRole('button', { name: 'Accept: Use "a" to introduce "the processor" at its first mention.' }).click();
  await expect(claim(page, 3)).toContainText('wherein a processor is configured');
  await expect(cards).toHaveCount(4);
  await tab(page, 'Issues').click();
  await expect(page.getByRole('list', { name: 'Issues' })).not.toContainText('"the processor"');
  await page.keyboard.press('Control+z');
  await expect(claim(page, 3)).toContainText('wherein the processor is configured');
});

test('the server streams suggestions as separate events over time', async ({ page, request }) => {
  await openDraft(page, request);
  const arrivals = await page.evaluate(async () => {
    const draft = JSON.parse(window.localStorage.getItem('claim-editor:document:v1') ?? '{}') as { claims: unknown[] };
    const response = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claims: draft.claims }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const start = performance.now();
    const times: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const count = (decoder.decode(value).match(/event: suggestion/g) ?? []).length;
      for (let i = 0; i < count; i += 1) times.push(performance.now() - start);
    }
    return times;
  });
  expect(arrivals).toHaveLength(5);
  expect(arrivals[4] - arrivals[0]).toBeGreaterThan(150);
});

test('keyboard: alt+] selects the next suggestion, alt+enter accepts, alt+backspace rejects', async ({ page, request }) => {
  await openDraft(page, request);
  await tab(page, 'Suggestions').click();
  await expect(page.locator('.suggestion')).toHaveCount(5);
  await page.keyboard.press('Alt+BracketRight');
  await expect(page.locator('.suggestion.active')).toContainText('in order to');
  await page.keyboard.press('Alt+Enter');
  await expect(claim(page, 4)).not.toContainText('in order to');
  await expect(page.locator('.suggestion')).toHaveCount(4);
  await page.keyboard.press('Alt+Backspace');
  await expect(page.locator('.suggestion')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Show 1 dismissed/ })).toBeVisible();
});

test('F8 jumps to an issue and selects the offending text', async ({ page, request }) => {
  await openDraft(page, request);
  await page.keyboard.press('F8');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toBeTruthy();
});

test('specification support flags unused terms and clears when the description covers them', async ({ page, request }) => {
  await openDraft(page, request);
  await tab(page, 'Support').click();
  await expect(page.getByText('10 of 12 claim terms are described')).toBeVisible();
  const missing = page.locator('.term-row.missing');
  await expect(missing).toHaveCount(2);
  await expect(missing.first()).toContainText('baseline value');
  await expect(missing.nth(1)).toContainText('memory');
  await expect(page.locator('.hl-spec')).toHaveCount(2);

  await page.getByRole('textbox', { name: 'Description' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nThe baseline value is kept in a memory.');
  await expect(page.getByText('12 of 12 claim terms are described')).toBeVisible();
  await expect(page.locator('.hl-spec')).toHaveCount(0);
});

test('an empty description shows an empty state instead of flagging everything', async ({ page, request }) => {
  await openDraft(page, request, { title: 'Blank spec', spec: '', claims: [{ id: 'c1', number: 1, text: 'A kettle comprising a lid.' }] });
  await tab(page, 'Support').click();
  await expect(page.getByText('No description yet')).toBeVisible();
  await expect(page.locator('.hl-spec')).toHaveCount(0);
});

test('version history: save, preview the differences, restore', async ({ page, request }) => {
  await openDraft(page, request);
  await tab(page, 'History').click();
  await expect(page.getByRole('list', { name: 'Versions' })).toContainText('Initial draft');

  await page.getByLabel('Version label').fill('Baseline');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Versions' }).locator('li').first()).toContainText('Baseline');

  await clickEndOfClaim(page, 2);
  await page.keyboard.type(' It is also waterproof.');
  await expect(claim(page, 2)).toContainText('waterproof');

  await page.getByRole('list', { name: 'Versions' }).getByText('Baseline').click();
  await expect(page.locator('.change-list')).toContainText('edited since');
  await expect(page.locator('.change-list ins')).toContainText('waterproof.');
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(claim(page, 2)).not.toContainText('waterproof');
  await expect(page.locator('.toast')).toContainText('Version restored');
  await expect(page.getByRole('list', { name: 'Versions' }).locator('li').first()).toContainText('Before restore');
});

test('edits are autosaved to the server and survive a reload', async ({ page, request }) => {
  const id = await openDraft(page, request);
  await clickEndOfClaim(page, 8);
  await page.keyboard.type(' Persisted marker.');
  await expect.poll(async () => JSON.stringify(await (await request.get(`/api/drafts/${id}`)).json())).toContain('Persisted marker.');
  await page.reload();
  await expect(claim(page, 8)).toContainText('Persisted marker.');
});

test('works offline: banner, local suggestions, history paused', async ({ page, request }) => {
  await openDraft(page, request);
  await page.route('**/api/**', (route) => route.abort());
  await page.reload();
  await expect(page.getByText('Server not reachable')).toBeVisible();
  await expect(page.locator('p.claim').first()).toBeVisible();
  await tab(page, 'Suggestions').click();
  await expect(page.locator('.stream-status')).toContainText('local rules (offline)');
  await expect(page.locator('.suggestion').first()).toBeVisible();
  await tab(page, 'History').click();
  await expect(page.getByText('History needs the server')).toBeVisible();
});

test('theme toggle switches to dark and the choice persists', async ({ page, request }) => {
  await openDraft(page, request);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('shortcut dialog opens with ctrl+/ and closes with escape', async ({ page, request }) => {
  await openDraft(page, request);
  await page.keyboard.press('Control+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a phone-width layout stacks the panes without horizontal scroll', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDraft(page, request);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
