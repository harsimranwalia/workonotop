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

    test('should display the "Why Choose Work On Tap?" section with its five benefits', async ({ page }) => {
        await page.goto('/');

        // The "500,000+ / 96% / 4.8" stats strip is not on the page any more (none of the three occurs in src);
        // assert the benefits section the page has now (src/app/HomeClient.js:316-325).
        await expect(page.getByRole('heading', { name: 'Why Choose Work On Tap?' })).toBeVisible();
        for (const benefit of [
            'Multiple Services in One Place',
            'Practical Services for Everyday Needs',
            'Services Based on Your Actual Needs',
            'Simple Service Discovery',
            'Vancouver & Metro Vancouver Service Area',
        ]) {
            await expect(page.getByRole('heading', { name: benefit, exact: true })).toBeVisible();
        }
    });

    test('service detail page should display "How WorkOnTap works" section', async ({ page }) => {
        // The section is not on / any more; it is on the service detail page
        // (src/app/services/[serviceId]/ServiceDetailClientPage.jsx:203-231).
        await page.goto('/services/fixture-standard-clean');

        await expect(page.getByRole('heading', { name: 'How WorkOnTap works' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Tell us what you need', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Get matched instantly', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Chat & confirm', exact: true })).toBeVisible();
    });

    test('should navigate to /services with the search term when the Search button is clicked', async ({ page }) => {
        await page.goto('/');

        // The hero search is a controlled input whose Search button has no handler until React has hydrated it
        // (src/components/AnimatedSearchBar.jsx:81-93): wait for that, or typed text and the click can be lost.
        const searchButton = page.getByRole('button', { name: 'Search', exact: true });
        await expect.poll(() => searchButton.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$')))).toBe(true);

        // Clicking into the field does not navigate; the Search button (or Enter) does, with the term
        // (AnimatedSearchBar.jsx:44-54).
        const searchInput = page.locator('input[type="text"]').first();
        await searchInput.fill('furniture assembly');
        await searchButton.click();

        // A click-driven navigation to a route next dev has not compiled yet waits on that compile: give it the
        // navigation allowance (playwright.config.js navigationTimeout), not the 10 s expect budget.
        await expect(page).toHaveURL(/\/services\?search=furniture%20assembly$/, { timeout: 45_000 });
    });

    test('should have "Explore All Services" link that navigates correctly', async ({ page }) => {
        await page.goto('/');

        const viewAllLink = page.getByRole('link', { name: /Explore All Services/i }).first();
        await expect(viewAllLink).toBeVisible();
        await viewAllLink.click();

        // Click-driven navigation to a route next dev may have to compile first: the navigation allowance of
        // playwright.config.js, not the 10 s expect budget.
        await expect(page).toHaveURL(/\/services$/, { timeout: 45_000 });
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

    test('should display the service categories section with links to cleaning, moving and handyman services', async ({ page }) => {
        await page.goto('/');

        // The "What people in Calgary are doing now" block is gone (every current copy line is Vancouver);
        // the page's services block is src/app/HomeClient.js:101-125.
        await expect(page.getByRole('heading', { name: 'One Place for the Services You Need Most' })).toBeVisible();
        for (const [category, label] of [
            ['cleaning', 'Cleaning Services'],
            ['movers', 'Moving Services'],
            ['handyman', 'Handyman Services'],
        ]) {
            await expect(page.locator(`a[href="/services?category=${category}"]`, { hasText: label }).first()).toBeVisible();
        }
    });

    test('should display Homeowner Protection Promise section', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByText('Homeowner Protection Promise')).toBeVisible();
        await expect(page.getByText(/100% guaranteed/)).toBeVisible();
    });
});
