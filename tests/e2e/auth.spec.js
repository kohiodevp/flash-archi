import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login with valid API key redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="apiKey"]', process.env.API_KEY);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('login with invalid API key shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="apiKey"]', 'invalid-key');
    await page.click('button[type="submit"]');
    await expect(page.locator('.error-message')).toBeVisible();
  });
});