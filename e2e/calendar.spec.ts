import { test, expect } from './fixtures';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const FILE = '.e2e-data/calendar.json';
const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();
const berlinToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

function writeCalendar(events: unknown[], extra: Record<string, unknown> = {}) {
	mkdirSync('.e2e-data', { recursive: true });
	writeFileSync(FILE, JSON.stringify({ generatedAt: new Date().toISOString(), date: berlinToday, events, errors: [], ...extra }));
}

const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d';

test.describe.configure({ mode: 'serial' });
test.afterAll(() => rmSync(FILE, { force: true }));

test('next meeting with a direct Teams web-join button, later ones listed', async ({ page }) => {
	writeCalendar([
		{ subject: 'Vorbei', start: iso(-120), end: iso(-60), location: '', joinUrl: TEAMS, tentative: false, source: 'flagbit' },
		{ subject: 'Daily', start: iso(12), end: iso(27), location: '', joinUrl: TEAMS, tentative: false, source: 'runprise' },
		{ subject: 'Kunde vor Ort', start: iso(180), end: iso(240), location: 'Büro', joinUrl: null, tentative: false, source: 'flagbit' },
	]);
	await page.goto('/');
	const next = page.locator('.cal-next');
	await expect(next).toContainText('Daily');
	await expect(next).toContainText(/in 1[12] min/);
	await expect(next).toContainText('Runprise');
	const href = await next.locator('.cal-join').getAttribute('href');
	const url = new URL(href!);
	expect(url.pathname).toBe('/dl/launcher/launcher.html');
	expect(url.searchParams.get('msLaunch')).toBe('false');
	expect(url.searchParams.get('suppressPrompt')).toBe('true');
	await expect(page.locator('.cal-list li')).toHaveCount(1);
	await expect(page.locator('.cal-list li')).toContainText('Kunde vor Ort');
	await expect(page.locator('.cal-list .cal-join')).toHaveCount(0);
	await expect(page.locator('#calendar')).not.toContainText('Vorbei');
});

test('shows when a calendar source is down', async ({ page }) => {
	writeCalendar([], { errors: ['runprise'] });
	await page.goto('/');
	await expect(page.locator('.cal-notice')).toContainText('Runprise nicht abrufbar');
});

test('hidden when nothing is left today', async ({ page }) => {
	writeCalendar([{ subject: 'Vorbei', start: iso(-120), end: iso(-60), location: '', joinUrl: null, tentative: false, source: 'flagbit' }]);
	await page.goto('/');
	await expect(page.locator('.card').first()).toBeVisible();
	await expect(page.locator('#calendar')).toBeHidden();
});

test("yesterday's export is not shown as today", async ({ page }) => {
	writeCalendar([{ subject: 'Gestern', start: iso(30), end: iso(60), location: '', joinUrl: null, tentative: false, source: 'flagbit' }], { date: '2000-01-01' });
	await page.goto('/');
	await expect(page.locator('#calendar')).not.toContainText('Gestern');
});
