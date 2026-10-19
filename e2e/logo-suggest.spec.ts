import { test, expect } from './fixtures';

// Third-party logo services are stubbed: tests must not depend on the internet.
const RED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#e50914"/></svg>';

test('pasting a link suggests logos; picking one sets logo, name and card colour', async ({ page }) => {
	await page.route('https://cdn.simpleicons.org/**', (route) =>
		route.request().url().endsWith('/plex')
			? route.fulfill({ contentType: 'image/svg+xml', body: RED_SVG, headers: { 'Access-Control-Allow-Origin': '*' } })
			: route.fulfill({ status: 404 }),
	);
	await page.route('https://icon.horse/**', (route) => route.fulfill({ status: 404 }));
	await page.route('https://www.google.com/**', (route) => route.fulfill({ status: 404 }));

	await page.goto('/');
	await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
	await page.getByRole('button', { name: 'App hinzufügen' }).click();
	await page.locator('#app-url').fill('https://app.plex.tv/desktop');

	const suggestion = page.locator('.logo-suggest-item');
	await expect(suggestion).toHaveCount(1);
	await suggestion.click();
	await expect(suggestion).toHaveClass(/is-selected/);
	await expect(page.locator('#app-logo')).toHaveValue('https://cdn.simpleicons.org/plex');
	await expect(page.locator('#app-name')).toHaveValue('Plex');
	await expect(page.locator('#app-color')).toHaveValue('#e50914');

	await page.locator('#app-submit').click();
	const card = page.locator('.card', { hasText: 'Plex' });
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute('style', /--app-color: #e50914/);
});

test('bundled logos are suggested first', async ({ page }) => {
	await page.route(/simpleicons|icon\.horse|google\.com/, (route) => route.fulfill({ status: 404 }));
	await page.goto('/');
	await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
	await page.getByRole('button', { name: 'App hinzufügen' }).click();
	await page.locator('#app-url').fill('netflix.com');
	await expect(page.locator('.logo-suggest-item').first()).toHaveAttribute('data-url', '/logos/netflix.svg');
});
