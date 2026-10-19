// Serves the built dashboard and persists its single shared state as a JSON file.
// Access control is expected in front of this server (Authentik forward auth).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { load } from 'js-yaml';
import { validateState, type DashboardState } from '../src/lib/state';
import { extractColor } from './color';
import { createHome, HomeError, loadHomeConfig, type TileAction } from './home';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = normalize(process.env.DIST_DIR ?? join(import.meta.dir, '../dist'));
const STATE_FILE = process.env.STATE_FILE ?? '/data/state.json';
const SEED_FILE = process.env.SEED_FILE ?? join(import.meta.dir, '../src/data/config.yml');
const SEED_REGION = process.env.SEED_REGION ?? 'DE';
const MAX_BODY_BYTES = 1024 * 1024;
const HOME_CONFIG = process.env.HOME_CONFIG ?? '/app/home.json';
const HA_URL = process.env.HA_URL ?? '';
const HA_TOKEN = process.env.HA_TOKEN ?? '';

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

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
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
	let relative: string;
	try {
		relative = path === '/' ? '/index.html' : decodeURIComponent(path);
	} catch {
		return new Response('Bad request', { status: 400 });
	}
	const filePath = normalize(join(DIST_DIR, relative));
	const file = Bun.file(filePath);
	if (!filePath.startsWith(DIST_DIR) || !(await file.exists())) return new Response('Not found', { status: 404 });

	const cache = relative.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
	return new Response(file, { headers: { 'Cache-Control': cache } });
}

Bun.serve({
	port: PORT,
	fetch(req) {
		const { pathname } = new URL(req.url);
		return pathname.startsWith('/api/') ? handleApi(req, pathname) : serveStatic(pathname);
	},
});

console.log(`[server] listening on :${PORT}, state ${STATE_FILE}`);
