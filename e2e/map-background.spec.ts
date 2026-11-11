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

test('the background map turns heading-up around the car, the car marker keeps pointing up', async ({
	context,
	page,
}) => {
	await context.route('https://embed.waze.com/**', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<html><body>map</body></html>' }),
	);
	await context.grantPermissions(['geolocation']);
	await context.setGeolocation({ latitude: 49, longitude: 8 });
	await page.goto('/');
	const map = page.locator('#bg-map');
	await expect(map).toBeVisible();
	await expect(map).not.toHaveAttribute('src', /pin=/);

	// Chromium's emulated positions carry no heading, so the direction comes from the movement: ~73 m east.
	await context.setGeolocation({ latitude: 49, longitude: 8.001 });
	await expect
		.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--map-rotation')))
		.toBe('-90.0deg');
	await expect(map).toHaveCSS('transform', /^matrix\(0(\.0+\d*)?(e-\d+)?, -1/);

	const car = page.locator('.bg-map-car');
	await expect(car).toBeVisible();
	await expect(car).toHaveCSS('transform', /^matrix\(1, 0, 0, 1,/);
});

for (const viewport of [
	{ width: 773, height: 601 }, // the car's split view
	{ width: 1280, height: 720 },
	{ width: 1920, height: 1200 },
]) {
	test(`the turned map covers a ${viewport.width}×${viewport.height} screen at any angle`, async ({ context, page }) => {
		await context.route('https://embed.waze.com/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<html><body>map</body></html>' }),
		);
		await context.grantPermissions(['geolocation']);
		await context.setGeolocation({ latitude: 49, longitude: 8 });
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page.locator('#bg-map')).toBeVisible();
		const box = await page.locator('#bg-map').evaluate((el: HTMLElement) => ({
			left: el.offsetLeft,
			top: el.offsetTop,
			size: el.offsetWidth,
			height: el.offsetHeight,
		}));
		expect(box.height).toBe(box.size);
		const centre = { x: box.left + box.size / 2, y: box.top + box.size / 2 };
		// The rotation centre is the car: 100 px below the middle of the screen.
		expect(centre.x).toBeCloseTo(viewport.width / 2, 0);
		expect(centre.y).toBeCloseTo(viewport.height / 2 + 100, 0);
		// A circle of this radius stays inside the square at any angle; Waze's chrome lies in its outer 460 px.
		const farthestCorner = Math.max(
			...[0, viewport.width].flatMap((x) => [0, viewport.height].map((y) => Math.hypot(x - centre.x, y - centre.y))),
		);
		expect(box.size / 2 - 460).toBeGreaterThanOrEqual(farthestCorner - 1);
	});
}
