import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const route of ['/vilkar', '/personvern', '/artist-app/signup']) {
  test(`${route} has no automatically detectable serious accessibility violations`, async ({ page }) => {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
}
