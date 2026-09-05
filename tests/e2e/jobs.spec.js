import { test, expect } from '@playwright/test';

test.describe('Job Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login avant chaque test
    await page.goto('/login');
    await page.fill('[name="apiKey"]', process.env.API_KEY);
    await page.click('button[type="submit"]');
  });

  test('submit prompt creates job with pending status', async ({ page }) => {
    await page.goto('/jobs/new');
    await page.fill('[name="prompt"]', 'Test building');
    await page.click('button[type="submit"]');
    await expect(page.locator('.job-status')).toHaveText('pending');
  });

  test('list jobs shows pagination', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.locator('.pagination')).toBeVisible();
  });
});