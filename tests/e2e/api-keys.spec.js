import { test, expect } from '@playwright/test';

test.describe('API Key Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="apiKey"]', process.env.API_KEY);
    await page.click('button[type="submit"]');
  });

  test('create new API key shows key once', async ({ page }) => {
    await page.goto('/api-keys');
    await page.click('button:has-text("Create")');
    await page.fill('[name="name"]', 'Test Key');
    await page.click('button[type="submit"]');

    // Key should be visible
    const keyValue = await page.locator('.api-key-value').textContent();
    expect(keyValue).toMatch(/^fa_[a-f0-9]{8}_/);

    // Navigate away and back - key should not be visible
    await page.goto('/api-keys');
    await expect(page.locator('.api-key-value')).not.toBeVisible();
  });
});