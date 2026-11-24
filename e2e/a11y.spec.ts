import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openDraft, tab } from './helpers';

const TABS = ['Issues', 'Suggestions', 'Support', 'History'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const scheme of ['light', 'dark'] as const) {
  test(`axe finds no WCAG 2.1 A/AA violations in ${scheme} mode on every tab`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDraft(page, request);
    await expect(page.locator('.suggestion').first()).toBeVisible().catch(() => undefined);
    let total = 0;
    for (const name of TABS) {
      await tab(page, name).click();
      await page.waitForTimeout(600);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      total += results.violations.length;
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `${scheme}/${name}`,
      ).toEqual([]);
    }
    console.log(`axe ${scheme}: ${TABS.length} tab states checked, ${total} violations`);
  });
}

test('axe: export menu and shortcut dialog', async ({ page, request }) => {
  await openDraft(page, request);
  await page.getByText('Export', { exact: true }).click();
  let results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+/');
  results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});
