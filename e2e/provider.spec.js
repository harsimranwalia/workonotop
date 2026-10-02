// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Provider Portal - Auth Protection', () => {

    test('should redirect protected provider routes to /provider/login', async ({ page }) => {
        // Any provider route that is not login/register/verify-email/rejected should redirect
        await page.goto('/provider/dashboard');
        await expect(page).toHaveURL(/\/provider\/login/);
    });

    test('should redirect /provider/profile to login when not authenticated', async ({ page }) => {
        await page.goto('/provider/profile');
        await expect(page).toHaveURL(/\/provider\/login/);
    });

    test('should redirect /provider/jobs to login when not authenticated', async ({ page }) => {
        await page.goto('/provider/jobs');
        await expect(page).toHaveURL(/\/provider\/login/);
    });

    test('should allow access to /provider/login without auth', async ({ page }) => {
        await page.goto('/provider/login');

        // Should stay on login page (no redirect)
        await expect(page).toHaveURL(/\/provider\/login/);
        await expect(page.locator('body')).toBeVisible();
    });

    test('should allow access to /provider/register without auth', async ({ page }) => {
        await page.goto('/provider/register');

        // Should stay on register page
        await expect(page).toHaveURL(/\/provider\/register/);
        await expect(page.locator('body')).toBeVisible();
    });

    test('provider login page should have form fields', async ({ page }) => {
        await page.goto('/provider/login');

        // The provider layout renders only a spinner until its /api/provider/me check returns
        // (src/app/provider/layout.js:75,:107,:122,:220), after page.goto has resolved on `load`: so wait
        // for the fields (an email and a password input) instead of counting inputs at once.
        await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
        await expect(page.locator('input[type="password"]').first()).toBeVisible();
    });

    test('provider login should reject invalid credentials', async ({ page }) => {
        await page.goto('/provider/login');

        const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
        const passwordInput = page.locator('input[type="password"]').first();

        await emailInput.fill('fake@provider.com');
        await passwordInput.fill('wrongpass123');

        const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();
        await submitBtn.click();

        await page.waitForTimeout(2000);
        // Should remain on login page
        await expect(page).toHaveURL(/\/provider\/login/);
    });
});
