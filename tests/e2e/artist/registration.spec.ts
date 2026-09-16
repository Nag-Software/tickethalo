import { expect, test } from '@playwright/test'

test('comedian registration exposes the required identity fields', async ({ page }) => {
  await page.goto('/artist-app/signup')

  await expect(page.getByRole('heading', { level: 1, name: 'Register comedian profile' })).toBeVisible()
  await expect(page.getByLabel('Full Name')).toHaveAttribute('required', '')
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('minlength', '8')
  await expect(page.getByLabel('Phone')).toHaveAttribute('type', 'tel')
})

test('comedian registration posts multipart data to the registration route', async ({ page }) => {
  await page.goto('/artist-app/signup')

  const form = page.locator('form')
  await expect(form).toHaveAttribute('method', 'post')
  await expect(form).toHaveAttribute('action', '/artist-app/signup/submit')
  await expect(form).toHaveAttribute('enctype', 'multipart/form-data')
  await expect(page.getByRole('button', { name: 'Register Artist Profile' })).toBeDisabled()
})
