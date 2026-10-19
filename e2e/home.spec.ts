import { test, expect, pairedContext } from './fixtures';
import type { Page } from '@playwright/test';

async function enterEditMode(page: Page) {
	await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
	await expect(page.locator('body')).toHaveClass(/is-editing/);
}

test('shows only the app grid, no header, launcher or analytics', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.card').first()).toBeVisible();
	await expect(page.locator('header, .launcher-wrap, footer')).toHaveCount(0);
	expect(await page.locator('script[src*="umami"]').count()).toBe(0);
	const href = await page.locator('.card', { hasText: 'Netflix' }).getAttribute('href');
	expect(href).toBe('https://www.youtube.com/redirect?q=' + encodeURIComponent('https://www.netflix.com'));
});

test('added app is stored on the server, not in the browser', async ({ page, browser }) => {
	await page.goto('/');
	await enterEditMode(page);
	await page.getByRole('button', { name: 'App hinzufügen' }).click();
	await page.locator('#app-name').fill('Home Assistant');
	await page.locator('#app-url').fill('ha.example.com');
	await page.locator('#app-category').selectOption('__new__');
	await page.locator('#app-new-cat').fill('Zuhause');
	await page.locator('.toggle-switch').click();
	await expect(page.locator('#app-fullscreen')).not.toBeChecked();
	await page.locator('#app-submit').click();

	const card = page.locator('.card', { hasText: 'Home Assistant' });
	await expect(card).toBeVisible();
	await expect.poll(async () => (await page.request.get('/api/state')).json())
		.toMatchObject({ categories: expect.arrayContaining([expect.objectContaining({ name: 'Zuhause' })]) });
	expect(await page.evaluate(() => localStorage.length)).toBe(0);

	// A fresh browser context (think: the car) sees the same app.
	const other = await pairedContext(browser);
	const otherPage = await other.newPage();
	await otherPage.goto('/');
	const otherCard = otherPage.locator('.card', { hasText: 'Home Assistant' });
	await expect(otherCard).toHaveAttribute('href', 'https://ha.example.com/');
	await other.close();
});

test('logo color is computed in the browser', async ({ page }) => {
	await page.goto('/');
	await enterEditMode(page);
	await page.getByRole('button', { name: 'App hinzufügen' }).click();
	await page.locator('#app-name').fill('Tube');
	await page.locator('#app-url').fill('https://www.youtube.com');
	await page.locator('#app-logo').fill('/logos/youtube.svg');
	await page.locator('#app-submit').click();
	await expect(page.locator('.card', { hasText: 'Tube' }).first()).toBeVisible();
	await expect.poll(async () => {
		const state = await (await page.request.get('/api/state')).json();
		return state.categories.flatMap((c: { apps: { name: string; color: string }[] }) => c.apps).find((a: { name: string }) => a.name === 'Tube')?.color;
	}).toBe('#ff0000');
});

test('edit, delete and rename persist across reloads', async ({ page }) => {
	await page.goto('/');
	await enterEditMode(page);

	await page.locator('.card', { hasText: 'Waze' }).click();
	await page.locator('#app-name').fill('Waze Navi');
	await page.locator('#app-submit').click();
	await expect(page.locator('.card', { hasText: 'Waze Navi' })).toBeVisible();

	await page.locator('.card', { hasText: 'Xbox Cloud' }).locator('.card-delete').click();
	await expect(page.locator('.card', { hasText: 'Xbox Cloud' })).toHaveCount(0);

	await page.locator('.category', { hasText: 'Sport' }).getByRole('button', { name: 'Bearbeiten' }).click();
	await page.locator('#cat-name').fill('Sport live');
	await page.locator('#cat-form button[type=submit]').click();

	await page.waitForLoadState('networkidle');
	await page.reload();
	await expect(page.locator('.card', { hasText: 'Waze Navi' })).toBeVisible();
	await expect(page.locator('.card', { hasText: 'Xbox Cloud' })).toHaveCount(0);
	await expect(page.locator('.category-title', { hasText: 'Sport live' })).toBeVisible();
});

test('dragging a card into another category persists', async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 2000 });
	await page.goto('/');
	await enterEditMode(page);
	// Drag upwards: removing the card from its old grid then cannot shift the drop target.
	const source = page.locator('.card', { hasText: 'GeForce Now' });
	const target = page.locator('.category', { hasText: 'Streaming' }).locator('.card').first();

	const from = (await source.boundingBox())!;
	const to = (await target.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 3 });
	await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 10 });
	await page.mouse.up();

	await page.waitForLoadState('networkidle');
	await page.reload();
	await expect(page.locator('.category', { hasText: 'Streaming' }).locator('.card').first()).toContainText('GeForce Now');
	await expect(page.locator('.category', { hasText: 'Gaming' }).locator('.card', { hasText: 'GeForce Now' })).toHaveCount(0);
});

test('a stale tab gets the newer state instead of overwriting it', async ({ page, browser }) => {
	await page.goto('/');
	const other = await pairedContext(browser);
	const otherPage = await other.newPage();
	await otherPage.goto('/');
	await enterEditMode(otherPage);
	await otherPage.locator('.card', { hasText: 'Ventusky' }).locator('.card-delete').click();
	await expect(otherPage.locator('.card', { hasText: 'Ventusky' })).toHaveCount(0);
	await otherPage.waitForLoadState('networkidle');
	await other.close();

	// First tab still shows Ventusky and now edits from its stale revision.
	await enterEditMode(page);
	await page.locator('.card', { hasText: 'PlugShare' }).locator('.card-delete').click();
	await expect(page.locator('#toast')).toContainText('woanders geändert');
	await expect(page.locator('.card', { hasText: 'Ventusky' })).toHaveCount(0);
	await expect(page.locator('.card', { hasText: 'PlugShare' })).toBeVisible();
});

test('touch: long press picks a card up, a quick swipe does not', async ({ browser }) => {
	const context = await pairedContext(browser, { hasTouch: true, viewport: { width: 1920, height: 2000 } });
	const page = await context.newPage();
	await page.goto('/');
	await enterEditMode(page);
	const cdp = await context.newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

	const source = page.locator('.card', { hasText: 'Eurosport' });
	const target = page.locator('.category', { hasText: 'Streaming' }).locator('.card').first();
	const from = (await source.boundingBox())!;
	const to = (await target.boundingBox())!;
	const sx = from.x + from.width / 2, sy = from.y + from.height / 2;

	// Quick swipe: no drag starts.
	await touch('touchStart', sx, sy);
	await touch('touchMove', sx, sy + 40);
	await page.waitForTimeout(500);
	expect(await page.locator('.touch-ghost').count()).toBe(0);
	await touch('touchEnd', sx, sy + 40);

	// Long press, then move.
	await touch('touchStart', sx, sy);
	await page.waitForTimeout(500);
	expect(await page.locator('.touch-ghost').count()).toBe(1);
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', sx + ((to.x + 10 - sx) * i) / 10, sy + ((to.y + to.height / 2 - sy) * i) / 10);
	}
	await touch('touchEnd', to.x + 10, to.y + to.height / 2);

	await page.waitForLoadState('networkidle');
	await page.reload();
	await expect(page.locator('.category', { hasText: 'Streaming' }).locator('.card').first()).toContainText('Eurosport');
	await context.close();
});
