import { test, expect, pairedContext } from './fixtures';
import type { Browser, Page } from '@playwright/test';

// All actions here hit e2e/mock-ha.ts, never a real Home Assistant.
const MOCK = 'http://localhost:4174';

async function calls(page: Page) {
	return (await page.request.get(`${MOCK}/__calls`)).json();
}

async function open(browser: Browser) {
	const context = await pairedContext(browser);
	const page = await context.newPage();
	await page.request.get(`${MOCK}/__reset`);
	await page.goto('/');
	await expect(page.locator('.home-tile').first()).toBeVisible();
	return { context, page };
}

async function hold(page: Page, selector: string, ms: number) {
	const box = (await page.locator(selector).boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(ms);
	await page.mouse.up();
}

test.describe.configure({ mode: 'serial' });

test('shows house tiles with icons', async ({ browser }) => {
	const { context, page } = await open(browser);
	await expect(page.locator('.home-tile[data-id=garage]')).toContainText('Geschlossen');
	await expect(page.locator('.home-tile[data-id=garage]')).toContainText('Halten zum Öffnen');
	await expect(page.locator('.home-tile .home-tile-icon')).toHaveCount(2);
	await context.close();
});

test('lights are only offered while it is dark', async ({ browser }) => {
	const { context, page } = await open(browser);
	await expect(page.locator('.home-tile')).toHaveCount(2);
	await page.request.get(`${MOCK}/__sun?state=above_horizon`);
	await page.reload();
	await expect(page.locator('.home-tile[data-id=garage]')).toBeVisible();
	await expect(page.locator('.home-tile')).toHaveCount(1);
	await page.request.get(`${MOCK}/__sun?state=below_horizon`);
	await context.close();
});

test('a light toggles with a single tap', async ({ browser }) => {
	const { context, page } = await open(browser);
	await page.locator('.home-tile[data-id=aussenlicht]').click();
	await expect.poll(() => calls(page)).toEqual([{ service: 'light.toggle', entity_id: 'light.hund' }]);
	await expect(page.locator('.home-tile[data-id=aussenlicht]')).toHaveAttribute('data-state', 'on');
	await context.close();
});

test('garage: a short tap does nothing', async ({ browser }) => {
	const { context, page } = await open(browser);
	await page.locator('.home-tile[data-id=garage]').click();
	await hold(page, '.home-tile[data-id=garage]', 300);
	await page.waitForTimeout(500);
	expect(await calls(page)).toEqual([]);
	await context.close();
});

test('garage: holding near home opens, holding again closes', async ({ browser }) => {
	const { context, page } = await open(browser);
	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect.poll(() => calls(page)).toEqual([{ service: 'cover.open_cover', entity_id: 'cover.garagentor' }]);
	await expect(page.locator('.home-tile[data-id=garage]')).toHaveAttribute('data-state', 'open');

	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect.poll(async () => (await calls(page)).at(-1)).toEqual({ service: 'cover.close_cover', entity_id: 'cover.garagentor' });
	await context.close();
});

test('garage: refused when the car (per HA) is away from home', async ({ browser }) => {
	const { context, page } = await open(browser);
	await page.request.get(`${MOCK}/__car?lat=50.2&lon=8.6`); // ~11 km away
	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect(page.locator('#toast')).toContainText('nur, wenn das Auto zu Hause ist');
	expect(await calls(page)).toEqual([]);
	await context.close();
});

test('garage: refused when HA has no car position', async ({ browser }) => {
	const { context, page } = await open(browser);
	await page.request.get(`${MOCK}/__car`);
	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect(page.locator('#toast')).toContainText('nur, wenn das Auto zu Hause ist');
	expect(await calls(page)).toEqual([]);
	await context.close();
});

test('API rejects actions that are not configured', async ({ request }) => {
	await request.get(`${MOCK}/__reset`);
	const unknown = await request.post('/api/home/tiles/haustuer', { data: { action: 'toggle' } });
	expect(unknown.status()).toBe(404);
	const wrongAction = await request.post('/api/home/tiles/aussenlicht', { data: { action: 'open' } });
	expect(wrongAction.status()).toBe(400);
	// A position sent by the client is ignored: the car is away per HA, so this is refused.
	await request.get(`${MOCK}/__car?lat=50.2&lon=8.6`);
	const spoofed = await request.post('/api/home/tiles/garage', { data: { action: 'open', position: { lat: 50.1, lon: 8.6 } } });
	expect(spoofed.status()).toBe(403);
	expect(await spoofed.json()).toEqual({ error: 'car not at home' });
	expect(await (await request.get(`${MOCK}/__calls`)).json()).toEqual([]);
});
