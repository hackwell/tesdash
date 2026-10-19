import { test as base, type Browser, type BrowserContextOptions } from '@playwright/test';

// Without a reverse proxy in tests, the Authentik header is sent directly (the proxy normally sets it on /admin only).
export const APPROVER = { 'X-authentik-username': 'tester', 'X-Tesla-Proxy-Auth': 'test-proxy-secret' };

/** A browser context that is already paired, like a car after the QR-code login. */
export async function pairedContext(browser: Browser, options: BrowserContextOptions = {}) {
	const context = await browser.newContext({ baseURL: 'http://localhost:4173', ...options });
	await context.request.post('/api/admin/pair-self', { headers: APPROVER, data: { name: 'e2e' } });
	return context;
}

export const test = base.extend({
	context: async ({ browser }, use) => {
		const context = await pairedContext(browser);
		await use(context);
		await context.close();
	},
	page: async ({ context }, use) => {
		await use(await context.newPage());
	},
	request: async ({ context }, use) => {
		await use(context.request);
	},
});

export { expect } from '@playwright/test';
