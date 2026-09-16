import { expect, test } from '@playwright/test'

test('platform terms identify Tickethalo as the ticket agent', async ({ page }) => {
  await page.goto('/vilkar')

  await expect(page.getByRole('heading', { level: 1, name: 'Platform terms' })).toBeVisible()
  await expect(page.getByText('Tickethalo is a ticket agent.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'terms of purchase', exact: true })).toHaveAttribute(
    'href',
    '/kjopsvilkar',
  )
})

test('privacy page exposes the support contact and platform terms', async ({ page }) => {
  await page.goto('/personvern')

  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'hei@tickethalo.com' })).toHaveAttribute(
    'href',
    'mailto:hei@tickethalo.com',
  )
  await expect(page.getByRole('link', { name: 'platform terms', exact: true })).toHaveAttribute('href', '/vilkar')
})
