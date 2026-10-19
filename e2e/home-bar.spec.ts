import { test, expect, type Browser, type Page } from '@playwright/test';

// All actions here hit e2e/mock-ha.ts, never a real Home Assistant.
const MOCK = 'http://localhost:4174';
const NEAR_HOME = { latitude: 50.1005, longitude: 8.6005 }; // ~70 m from the mock's home
const FAR_AWAY = { latitude: 50.2, longitude: 8.6 }; // ~11 km

async function calls(page: Page) {
	return (await page.request.get(`${MOCK}/__calls`)).json();
}

async function open(browser: Browser, geolocation?: { latitude: number; longitude: number }) {
	const context = await browser.newContext(
		geolocation ? { geolocation, permissions: ['geolocation'] } : {},
	);
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

test('shows car status and house tiles', async ({ browser }) => {
	const { context, page } = await open(browser);
	await expect(page.locator('#home-status')).toContainText('Akku36 %');
	await expect(page.locator('#home-status')).toContainText('Reichweite201 km');
	await expect(page.locator('#home-status')).toContainText('Außen11 °C');
	await expect(page.locator('.home-tile[data-id=garage]')).toContainText('Geschlossen');
	await expect(page.locator('.home-tile[data-id=garage]')).toContainText('Halten zum Öffnen');
	await context.close();
});

test('a light toggles with a single tap', async ({ browser }) => {
	const { context, page } = await open(browser);
	await page.locator('.home-tile[data-id=licht-garage]').click();
	await expect.poll(() => calls(page)).toEqual([{ service: 'light.toggle', entity_id: 'light.0x00178801067e284f' }]);
	await expect(page.locator('.home-tile[data-id=licht-garage]')).toHaveAttribute('data-state', 'on');
	await context.close();
});

test('garage: a short tap does nothing', async ({ browser }) => {
	const { context, page } = await open(browser, NEAR_HOME);
	await page.locator('.home-tile[data-id=garage]').click();
	await hold(page, '.home-tile[data-id=garage]', 300);
	await page.waitForTimeout(500);
	expect(await calls(page)).toEqual([]);
	await context.close();
});

test('garage: holding near home opens, holding again closes', async ({ browser }) => {
	const { context, page } = await open(browser, NEAR_HOME);
	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect.poll(() => calls(page)).toEqual([{ service: 'cover.open_cover', entity_id: 'cover.garagentor' }]);
	await expect(page.locator('.home-tile[data-id=garage]')).toHaveAttribute('data-state', 'open');

	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect.poll(async () => (await calls(page)).at(-1)).toEqual({ service: 'cover.close_cover', entity_id: 'cover.garagentor' });
	await context.close();
});

test('garage: refused away from home', async ({ browser }) => {
	const { context, page } = await open(browser, FAR_AWAY);
	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect(page.locator('#toast')).toContainText('nur in der Nähe von zu Hause');
	expect(await calls(page)).toEqual([]);
	await context.close();
});

test('garage: refused without a position', async ({ browser }) => {
	const { context, page } = await open(browser);
	await hold(page, '.home-tile[data-id=garage]', 1100);
	await expect(page.locator('#toast')).toContainText('Standort nicht verfügbar');
	expect(await calls(page)).toEqual([]);
	await context.close();
});

test('API rejects actions that are not configured', async ({ request }) => {
	await request.get(`${MOCK}/__reset`);
	const unknown = await request.post('/api/home/tiles/haustuer', { data: { action: 'toggle' } });
	expect(unknown.status()).toBe(404);
	const wrongAction = await request.post('/api/home/tiles/licht-garage', { data: { action: 'open' } });
	expect(wrongAction.status()).toBe(400);
	const noPosition = await request.post('/api/home/tiles/garage', { data: { action: 'open' } });
	expect(noPosition.status()).toBe(400);
	expect(await (await request.get(`${MOCK}/__calls`)).json()).toEqual([]);
});
