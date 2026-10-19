// Serves the built dashboard and persists its single shared state as a JSON file.
// Access: every device needs a device cookie from pairing (server/pairing.ts). Only /admin and /api/admin sit
// behind Authentik forward auth; the reverse proxy must strip X-authentik-* headers on every other route.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { load } from 'js-yaml';
import { validateState, type DashboardState } from '../src/lib/state';
import { extractColor } from './color';
import { createHome, HomeError, loadHomeConfig, type TileAction } from './home';
import { timingSafeEqual } from 'crypto';
import { canonicalPath } from './paths';
import { cookie, createPairing, DEVICE_COOKIE, PAIR_COOKIE, parseCookies } from './pairing';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = normalize(process.env.DIST_DIR ?? join(import.meta.dir, '../dist'));
const STATE_FILE = process.env.STATE_FILE ?? '/data/state.json';
const SEED_FILE = process.env.SEED_FILE ?? join(import.meta.dir, '../src/data/config.yml');
const SEED_REGION = process.env.SEED_REGION ?? 'DE';
const MAX_BODY_BYTES = 1024 * 1024;
const HOME_CONFIG = process.env.HOME_CONFIG ?? '/app/home.json';
const HA_URL = process.env.HA_URL ?? '';
const HA_TOKEN = process.env.HA_TOKEN ?? '';
// Written by calendar-export.py (runs as Wellbot on the host), mounted read-only.
const CALENDAR_FILE = process.env.CALENDAR_FILE ?? '/calendar/today.json';
const CALENDAR_STALE_MS = 10 * 60 * 1000;
const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });
const DEVICES_FILE = process.env.DEVICES_FILE ?? join(dirname(STATE_FILE), 'devices.json');
// Authentik usernames allowed to approve devices (header set by forward auth on /admin routes only).
// The proxy also sends PROXY_AUTH_SECRET on those routes, so containers on the same Docker network
// cannot forge the username header by talking to this server directly.
const PROXY_AUTH_SECRET = process.env.PROXY_AUTH_SECRET ?? '';
const PAIR_APPROVERS = new Set((process.env.PAIR_APPROVERS ?? '').split(',').map((u) => u.trim()).filter(Boolean));
const DEVICE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const PAIR_MAX_AGE_MS = 5 * 60 * 1000;
// Reachable without a device: the pairing page and the assets it needs.
const PUBLIC_DIRS = ['/pair', '/_astro'];
const PUBLIC_FILES = new Set(['/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/android-chrome-192x192.png', '/android-chrome-512x512.png', '/site.webmanifest']);

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

interface StoredState extends DashboardState {
	revision: number;
}

interface SeedApp {
	name: string;
	url: string;
	logo: string;
	color?: string;
	regions?: string[];
	fullscreen?: boolean;
	invert?: boolean;
	scale?: number;
}

/** First start: build the state from the bundled config.yml, keeping apps available in SEED_REGION. */
async function buildSeed(): Promise<StoredState> {
	const config = load(readFileSync(SEED_FILE, 'utf-8')) as { categories: { name: string; apps: SeedApp[] }[] };
	const categories = await Promise.all(
		config.categories.map(async (cat) => ({
			id: crypto.randomUUID(),
			name: cat.name,
			apps: await Promise.all(
				cat.apps
					.filter((app) => !app.regions?.length || app.regions.includes(SEED_REGION))
					.map(async (app) => ({
						id: crypto.randomUUID(),
						name: app.name,
						url: app.url,
						logo: app.logo,
						color: await extractColor(app.logo, DIST_DIR, app.color ?? '#ffffff'),
						fullscreen: app.fullscreen !== false,
						...(app.invert ? { invert: true } : {}),
						...(app.scale !== undefined ? { scale: app.scale } : {}),
					})),
			),
		})),
	);
	return { revision: 1, ...validateState({ categories: categories.filter((c) => c.apps.length) }) };
}

function writeState(state: StoredState): void {
	mkdirSync(dirname(STATE_FILE), { recursive: true });
	const tmp = `${STATE_FILE}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, '\t'));
	renameSync(tmp, STATE_FILE);
}

async function loadState(): Promise<StoredState> {
	if (existsSync(STATE_FILE)) {
		const stored = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
		return { revision: Number(stored.revision) || 1, ...validateState(stored) };
	}
	const seed = await buildSeed();
	writeState(seed);
	console.log(`[state] seeded ${STATE_FILE} from ${SEED_FILE} (region ${SEED_REGION})`);
	return seed;
}

let state = await loadState();

const homeConfig = loadHomeConfig(HOME_CONFIG);
const home = homeConfig && HA_URL && HA_TOKEN ? createHome(homeConfig, HA_URL.replace(/\/$/, ''), HA_TOKEN) : null;
console.log(home ? `[home] ${homeConfig!.tiles.length} tiles via ${HA_URL}` : '[home] disabled (no config or HA_URL/HA_TOKEN)');

const pairing = createPairing(DEVICES_FILE);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function fromProxy(req: Request): boolean {
	const sent = Buffer.from(req.headers.get('x-tesla-proxy-auth') ?? '');
	const expected = Buffer.from(PROXY_AUTH_SECRET);
	return expected.length > 0 && sent.length === expected.length && timingSafeEqual(sent, expected);
}

function approver(req: Request): string | null {
	if (!fromProxy(req)) return null;
	const user = req.headers.get('x-authentik-username');
	return user && PAIR_APPROVERS.has(user) ? user : null;
}

function clientIp(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
	// Traefik sets X-Real-Ip from the TCP peer; without a proxy fall back to the socket address.
	return req.headers.get('x-real-ip') ?? server.requestIP(req)?.address ?? 'unknown';
}

async function handlePairApi(req: Request, path: string, ip: string): Promise<Response | null> {
	if (path === '/api/pair/start' && req.method === 'POST') {
		const started = pairing.start(ip, req.headers.get('user-agent') ?? '');
		if (!started) return json({ error: 'too many pairing attempts' }, 429);
		return json({ ref: started.ref, code: started.code }, 200, { 'Set-Cookie': cookie(PAIR_COOKIE, started.pollToken, PAIR_MAX_AGE_MS) });
	}
	if (path === '/api/pair/status' && req.method === 'GET') {
		const result = pairing.poll(parseCookies(req.headers.get('cookie'))[PAIR_COOKIE]);
		if (typeof result === 'string') return json({ status: result });
		return json({ status: 'approved' }, 200, { 'Set-Cookie': cookie(DEVICE_COOKIE, result.deviceToken, DEVICE_MAX_AGE_MS) });
	}
	return null;
}

async function handleAdminApi(req: Request, path: string): Promise<Response> {
	const user = approver(req);
	if (!user) return json({ error: 'forbidden' }, 403);

	if (path === '/api/admin/devices' && req.method === 'GET') return json({ user, devices: pairing.list() });

	if (path === '/api/admin/pairing' && req.method === 'GET') {
		const info = pairing.describe(new URL(req.url).searchParams.get('ref') ?? '');
		return info ? json(info) : json({ error: 'unknown or expired' }, 404);
	}

	if (path === '/api/admin/approve' && req.method === 'POST') {
		let body: { ref?: string; code?: string; name?: string };
		try {
			body = (await readJson(req)) as typeof body;
		} catch {
			return json({ error: 'invalid JSON' }, 400);
		}
		const pollToken = parseCookies(req.headers.get('cookie'))[PAIR_COOKIE];
		const sameBrowser = pairing.startedBy(body.ref ?? '', pollToken);
		const deviceToken = pairing.approve(body.ref ?? '', body.code ?? '', body.name ?? 'Tesla', user, sameBrowser);
		if (deviceToken === 'wrong-code') return json({ error: 'wrong code' }, 400);
		if (!deviceToken) return json({ error: 'unknown or expired' }, 404);
		console.log(`[pair] ${user} approved a device`);
		if (!sameBrowser) return json({ ok: true });
		// Approved in the browser that showed the code: sign it in directly.
		pairing.poll(pollToken);
		return json({ ok: true, signedIn: true }, 200, { 'Set-Cookie': cookie(DEVICE_COOKIE, deviceToken, DEVICE_MAX_AGE_MS) });
	}

	if (path === '/api/admin/pair-self' && req.method === 'POST') {
		let body: { name?: string } = {};
		try {
			body = (await readJson(req)) as typeof body;
		} catch {
			return json({ error: 'invalid JSON' }, 400);
		}
		const deviceToken = pairing.issueDevice(body.name ?? 'Browser', user);
		console.log(`[pair] ${user} paired their own browser`);
		return json({ ok: true }, 200, { 'Set-Cookie': cookie(DEVICE_COOKIE, deviceToken, DEVICE_MAX_AGE_MS) });
	}

	const revokeMatch = path.match(/^\/api\/admin\/devices\/([0-9a-f]{16})$/);
	if (revokeMatch && req.method === 'DELETE') {
		return pairing.revoke(revokeMatch[1]) ? json({ ok: true }) : json({ error: 'not found' }, 404);
	}

	return json({ error: 'not found' }, 404);
}

async function readJson(req: Request): Promise<unknown> {
	// Requiring JSON forces a CORS preflight, so other sites cannot post with the user's Authentik cookie.
	if (!req.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON expected');
	const text = await req.text();
	if (text.length > MAX_BODY_BYTES) throw new Error('body too large');
	return JSON.parse(text);
}

async function handleApi(req: Request, path: string): Promise<Response> {
	if (path === '/api/state' && req.method === 'GET') return json(state);

	if (path === '/api/state' && req.method === 'PUT') {
		let body: Record<string, unknown>;
		try {
			body = (await readJson(req)) as Record<string, unknown>;
		} catch {
			return json({ error: 'invalid JSON' }, 400);
		}
		// Optimistic locking: a tab that has been open in the car for days must not overwrite newer edits.
		if (body.revision !== state.revision) return json({ error: 'conflict', state }, 409);
		try {
			const next = { revision: state.revision + 1, ...validateState(body) };
			writeState(next);
			state = next;
			return json(state);
		} catch (err) {
			return json({ error: (err as Error).message }, 400);
		}
	}

	if (path === '/api/calendar' && req.method === 'GET') {
		if (!existsSync(CALENDAR_FILE)) return json({ enabled: false });
		try {
			const cal = JSON.parse(readFileSync(CALENDAR_FILE, 'utf-8'));
			const today = cal.date === berlinDate.format(new Date());
			return json({
				enabled: true,
				generatedAt: cal.generatedAt,
				stale: !today || Date.now() - Date.parse(cal.generatedAt) > CALENDAR_STALE_MS,
				errors: cal.errors ?? [],
				events: today ? cal.events : [],
			});
		} catch {
			return json({ enabled: true, stale: true, errors: ['export'], events: [] });
		}
	}

	if (path === '/api/home' && req.method === 'GET') {
		return json(home ? await home.snapshot() : { enabled: false });
	}

	const tileMatch = path.match(/^\/api\/home\/tiles\/([a-z0-9-]+)$/);
	if (tileMatch && req.method === 'POST') {
		if (!home) return json({ error: 'home disabled' }, 404);
		try {
			const body = (await readJson(req)) as { action?: TileAction };
			await home.act(tileMatch[1], body.action as TileAction);
			return json({ ok: true });
		} catch (err) {
			if (err instanceof HomeError) return json({ error: err.message }, err.status);
			return json({ error: 'invalid request' }, 400);
		}
	}

	return json({ error: 'not found' }, 404);
}

async function serveStatic(path: string): Promise<Response> {
	// `path` is already canonical (decoded, no dot segments).
	let relative = path;
	if (relative.endsWith('/')) relative += 'index.html';
	let filePath = normalize(join(DIST_DIR, relative));
	// "/pair" -> "/pair/index.html"
	if (!/\.[a-z0-9]+$/i.test(relative) && !(await Bun.file(filePath).exists())) filePath = join(filePath, 'index.html');
	const file = Bun.file(filePath);
	if (!filePath.startsWith(DIST_DIR) || !(await file.exists())) return new Response('Not found', { status: 404 });

	const cache = relative.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
	return new Response(file, { headers: { 'Cache-Control': cache } });
}

async function handle(req: Request, server: Parameters<typeof clientIp>[1]): Promise<Response> {
	const pathname = canonicalPath(new URL(req.url).pathname);
	if (!pathname) return new Response('Bad request', { status: 400 });

	if (under(pathname, '/api/admin')) return handleAdminApi(req, pathname);
	if (under(pathname, '/api/pair')) return (await handlePairApi(req, pathname, clientIp(req, server))) ?? json({ error: 'not found' }, 404);
	if (under(pathname, '/admin')) {
		return approver(req) ? serveStatic(pathname) : new Response('Forbidden', { status: 403 });
	}
	if (PUBLIC_DIRS.some((dir) => under(pathname, dir)) || PUBLIC_FILES.has(pathname)) return serveStatic(pathname);

	const device = pairing.authenticate(req.headers.get('cookie'));
	if (!device) {
		if (pathname.startsWith('/api/')) return json({ error: 'device not paired' }, 401);
		return new Response(null, { status: 302, headers: { Location: '/pair/', 'Cache-Control': 'no-store' } });
	}
	return pathname.startsWith('/api/') ? handleApi(req, pathname) : serveStatic(pathname);
}

Bun.serve({ port: PORT, fetch: (req, server) => handle(req, server) });

console.log(`[server] listening on :${PORT}, state ${STATE_FILE}, ${PAIR_APPROVERS.size} approver(s)`);
if (!PAIR_APPROVERS.size || !PROXY_AUTH_SECRET) console.warn('[pair] PAIR_APPROVERS or PROXY_AUTH_SECRET missing: no device can be paired');
