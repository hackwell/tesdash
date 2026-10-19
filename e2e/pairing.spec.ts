import { test as base, expect, type Page } from '@playwright/test';
import { APPROVER, pairedContext } from './fixtures';

// Unpaired browsers on purpose: this file uses Playwright's plain test, not the paired fixture.
const test = base;

async function carPairing(page: Page) {
	await page.goto('/');
	await expect(page).toHaveURL(/\/pair\/$/);
	await expect(page.locator('#pair-code')).toHaveText(/^[A-HJ-NP-Z2-9]{4}$/);
	const code = (await page.locator('#pair-code').textContent())!.trim();
	const href = (await page.locator('#pair-alt').getAttribute('href'))!;
	const ref = new URL(href, 'http://x').searchParams.get('ref')!;
	return { code, ref, href };
}

test('an unpaired car is sent to the QR-code page and gets nothing from the API', async ({ page, request }) => {
	const { href, code } = await carPairing(page);
	expect(href).not.toContain(code); // the QR link alone cannot approve
	expect((await request.get('/api/state')).status()).toBe(401);
	expect((await request.get('/api/calendar')).status()).toBe(401);
	expect((await request.post('/api/home/tiles/garage', { data: { action: 'open' } })).status()).toBe(401);
});

test('typing the code from the car on the phone signs the car in', async ({ browser, page }) => {
	const { code, ref } = await carPairing(page);

	// The phone: a separate browser, signed in to Authentik (headers set by the proxy).
	const phone = await browser.newContext({ baseURL: 'http://localhost:4173', extraHTTPHeaders: APPROVER });
	const phonePage = await phone.newPage();
	await phonePage.goto(`/admin/?ref=${ref}`);
	await expect(phonePage.locator('#approve-info')).toContainText('Angefragt vor');
	await phonePage.locator('#approve-code').fill('ZZZZ' === code ? 'YYYY' : 'ZZZZ');
	await phonePage.locator('#approve-btn').click();
	await expect(phonePage.locator('#toast')).toContainText('Code stimmt nicht');
	await phonePage.locator('#approve-code').fill(code.toLowerCase());
	await phonePage.locator('#approve-name').fill('Model Y');
	await phonePage.locator('#approve-btn').click();
	await expect(phonePage.locator('#admin-status')).toContainText('Freigegeben');
	await expect(phonePage.locator('#device-list')).toContainText('Model Y');

	// The car polls and lands on the dashboard.
	await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
	await expect(page.locator('.card').first()).toBeVisible();
	await phone.close();
});

test('a pairing cannot be approved twice, unknown ones are refused', async ({ request, page }) => {
	const { code, ref } = await carPairing(page);
	expect((await request.post('/api/admin/approve', { headers: APPROVER, data: { ref, code } })).status()).toBe(200);
	expect((await request.post('/api/admin/approve', { headers: APPROVER, data: { ref, code } })).status()).toBe(404);
	expect((await request.post('/api/admin/approve', { headers: APPROVER, data: { ref: 'nope', code } })).status()).toBe(404);
});

test('only configured users coming through the proxy may approve', async ({ request, page }) => {
	const { code, ref } = await carPairing(page);
	const otherUser = { ...APPROVER, 'X-authentik-username': 'susanne' };
	const noProxySecret = { 'X-authentik-username': 'tester' };
	for (const headers of [otherUser, noProxySecret, {}]) {
		expect((await request.post('/api/admin/approve', { headers, data: { ref, code } })).status()).toBe(403);
	}
	expect((await request.get('/admin/', { headers: noProxySecret })).status()).toBe(403);
});

test('encoded path tricks never reach protected data', async ({ request }) => {
	// Clients may resolve %2e%2e themselves (then it is a plain /api/state request → 401); the server rejects the rest.
	for (const path of ['/pair/..%2Fapi%2Fstate', '/pair/%2e%2e/api/state', '/_astro/%2e%2e/index.html', '/pair/%2e%2e/admin/']) {
		expect([400, 401, 302, 403]).toContain((await request.get(path, { maxRedirects: 0 })).status());
	}
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
