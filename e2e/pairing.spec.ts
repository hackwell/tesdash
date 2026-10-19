import { test as base, expect } from '@playwright/test';
import { APPROVER, pairedContext } from './fixtures';

// Unpaired browsers on purpose: this file uses Playwright's plain test, not the paired fixture.
const test = base;

test('an unpaired car is sent to the QR-code page and gets nothing from the API', async ({ page, request }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/pair\/$/);
	await expect(page.locator('#pair-code')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
	expect((await request.get('/api/state')).status()).toBe(401);
	expect((await request.get('/api/calendar')).status()).toBe(401);
	expect((await request.post('/api/home/tiles/garage', { data: { action: 'open' } })).status()).toBe(401);
});

test('approving the code on the phone signs the car in', async ({ browser, page }) => {
	await page.goto('/');
	const code = (await page.locator('#pair-code').textContent())!.trim();
	const qrTarget = await page.locator('#pair-alt').getAttribute('href');
	expect(qrTarget).toContain(`/admin/?code=${code}`);

	// The phone: a separate browser, signed in to Authentik (header set by forward auth).
	const phone = await browser.newContext({ baseURL: 'http://localhost:4173', extraHTTPHeaders: APPROVER });
	const phonePage = await phone.newPage();
	await phonePage.goto(`/admin/?code=${code}`);
	await expect(phonePage.locator('#approve-code')).toHaveText(code);
	await phonePage.locator('#approve-name').fill('Model Y');
	await phonePage.locator('#approve-btn').click();
	await expect(phonePage.locator('#admin-status')).toContainText('Freigegeben');
	await expect(phonePage.locator('#device-list')).toContainText('Model Y');

	// The car polls and lands on the dashboard.
	await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
	await expect(page.locator('.card').first()).toBeVisible();
	await phone.close();
});

test('a code cannot be approved twice, unknown codes are refused', async ({ request, page }) => {
	await page.goto('/');
	const code = (await page.locator('#pair-code').textContent())!.trim();
	expect((await request.post('/api/admin/approve', { headers: APPROVER, data: { code } })).status()).toBe(200);
	expect((await request.post('/api/admin/approve', { headers: APPROVER, data: { code } })).status()).toBe(404);
	expect((await request.post('/api/admin/approve', { headers: APPROVER, data: { code: 'AAAA-BBBB' } })).status()).toBe(404);
});

test('only configured Authentik users may approve', async ({ request, page }) => {
	await page.goto('/');
	const code = (await page.locator('#pair-code').textContent())!.trim();
	const other = { 'X-authentik-username': 'susanne' };
	expect((await request.post('/api/admin/approve', { headers: other, data: { code } })).status()).toBe(403);
	expect((await request.post('/api/admin/approve', { data: { code } })).status()).toBe(403);
	expect((await request.get('/admin/', { headers: other })).status()).toBe(403);
});

test('a removed device is logged out', async ({ browser }) => {
	const car = await pairedContext(browser);
	const page = await car.newPage();
	await page.goto('/');
	await expect(page.locator('.card').first()).toBeVisible();

	const admin = await browser.newContext({ baseURL: 'http://localhost:4173', extraHTTPHeaders: APPROVER });
	const { devices } = await (await admin.request.get('/api/admin/devices')).json();
	for (const device of devices) await admin.request.delete(`/api/admin/devices/${device.id}`);

	await page.reload();
	await expect(page).toHaveURL(/\/pair\/$/);
	await admin.close();
	await car.close();
});
