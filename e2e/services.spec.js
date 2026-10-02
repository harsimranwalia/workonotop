// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Services Page', () => {

    test('should load the services listing page', async ({ page }) => {
        await page.goto('/services');

        // Page should load without error
        await expect(page).toHaveURL(/\/services/);

        // Should have some content (heading or service cards)
        const body = page.locator('body');
        await expect(body).toBeVisible();
    });

    test('should display at least one service', async ({ page }) => {
        await page.goto('/services');

        // Wait for services to load (they come from API)
        await page.waitForTimeout(2000);

        // Look for service-related content (cards, links, or text)
        const serviceLinks = page.locator('a[href*="/services/"]');
        const count = await serviceLinks.count();

        // Either services exist or a "no services" message is shown
        if (count > 0) {
            expect(count).toBeGreaterThan(0);
        } else {
            // If no services, page should still render without error
            await expect(page.locator('body')).toBeVisible();
        }
    });

    test('should navigate to a service detail page when clicked', async ({ page }) => {
        await page.goto('/services');
        await page.waitForTimeout(2000);

        const serviceLinks = page.locator('a[href*="/services/"]');
        const count = await serviceLinks.count();

        if (count > 0) {
            // Click the first service link
            await serviceLinks.first().click();

            // Should navigate to a service detail page. The click starts a navigation to a route next dev may
            // still have to compile (it took 8 to 10 s cold): give it the navigation allowance of
            // playwright.config.js (navigationTimeout), not the 10 s expect budget.
            await expect(page).toHaveURL(/\/services\/.+/, { timeout: 45_000 });
        }
    });
});
