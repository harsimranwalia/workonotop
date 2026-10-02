// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {

    test('should load and display the hero section', async ({ page }) => {
        await page.goto('/');

        // Hero heading (src/app/HomeClient.js:70-73)
        const heading = page.locator('h1');
        await expect(heading).toBeVisible();
        await expect(heading).toContainText('Cleaning, Moving & Handyman Services in Vancouver');
    });

    test('should display stats section (500,000+ / 96% / 4.8)', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByText('500,000+')).toBeVisible();
        await expect(page.getByText('96%')).toBeVisible();
        await expect(page.getByText('4.8')).toBeVisible();
    });

    test('should display "How WorkOnTap works" section', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByText('How WorkOnTap works')).toBeVisible();
        await expect(page.getByText('1. Tell us what you need')).toBeVisible();
        await expect(page.getByText('2. Instant matches')).toBeVisible();
        await expect(page.getByText('3. Pro arrives & fixes it')).toBeVisible();
        await expect(page.getByText('4. Pay & review')).toBeVisible();
    });

    test('should navigate to /services when search bar is clicked', async ({ page }) => {
        await page.goto('/');

        // Click the search bar area
        const searchInput = page.locator('input[type="text"]').first();
        await searchInput.click();

        await expect(page).toHaveURL(/\/services/);
    });

    test('should have "View all services" link that navigates correctly', async ({ page }) => {
        await page.goto('/');

        const viewAllLink = page.getByRole('link', { name: /View all services/i }).first();
        await expect(viewAllLink).toBeVisible();
        await viewAllLink.click();

        await expect(page).toHaveURL(/\/services/);
    });

    test('should display Header and Footer components', async ({ page }) => {
        await page.goto('/');

        // Header should be visible
        const header = page.locator('header').first();
        await expect(header).toBeVisible();

        // Footer should be visible  
        const footer = page.locator('footer').first();
        await expect(footer).toBeVisible();
    });

    test('should display homepage services or fallback message', async ({ page }) => {
        await page.goto('/');

        // Either services are rendered OR the fallback "No trending services" text
        const servicesSection = page.getByText('What people in Calgary are doing now');
        await expect(servicesSection).toBeVisible();
    });

    test('should display Homeowner Protection Promise section', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByText('Homeowner Protection Promise')).toBeVisible();
        await expect(page.getByText(/100% guaranteed/)).toBeVisible();
    });
});
