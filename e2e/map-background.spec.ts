import { test, expect } from './fixtures';

// The real Waze embed is never loaded: every request to it gets a stub page.
test('the background map follows the car without going blank', async ({ context, page }) => {
	await context.route('https://embed.waze.com/**', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<html><body>map</body></html>' }),
	);
	await context.grantPermissions(['geolocation']);
	await context.setGeolocation({ latitude: 49, longitude: 8 });
	await page.clock.install();
	await page.goto('/');

	const maps = page.locator('iframe.bg-map');
	await expect(maps).toHaveCount(1);
	await expect(maps).toHaveAttribute('src', /lat=49\.0000&lon=8\.0000/);
	await expect(maps).toBeVisible();

	await page.clock.fastForward(11_000);
	await context.setGeolocation({ latitude: 49.001, longitude: 8 });

	// The new map replaces the old one once loaded; the old one stays until then, so there is always one visible.
	await expect(maps).toHaveCount(1);
	await expect(maps).toHaveAttribute('src', /lat=49\.0010&lon=8\.0000/);
	await expect(maps).toHaveAttribute('id', 'bg-map');
	await expect(maps).toBeVisible();
});
