// Shared dashboard state: one document for everyone, stored on the server.

export interface App {
	id: string;
	name: string;
	url: string;
	logo: string;
	color: string;
	fullscreen: boolean;
	invert?: boolean;
	scale?: number;
}

export interface Category {
	id: string;
	name: string;
	apps: App[];
}

export interface DashboardState {
	categories: Category[];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_TEXT = 2048;

function isText(value: unknown, max = MAX_TEXT): value is string {
	return typeof value === 'string' && value.length <= max;
}

function isHttpUrl(value: unknown): value is string {
	if (!isText(value) || !value) return false;
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

function isLogo(value: unknown): value is string {
	return isText(value) && (value === '' || value.startsWith('/logos/') || isHttpUrl(value));
}

function validateApp(value: unknown, path: string): App {
	const app = value as Record<string, unknown>;
	if (!app || typeof app !== 'object') throw new Error(`${path}: not an object`);
	if (!isText(app.id, 64) || !app.id) throw new Error(`${path}.id invalid`);
	if (!isText(app.name, 100) || !app.name.trim()) throw new Error(`${path}.name invalid`);
	if (!isHttpUrl(app.url)) throw new Error(`${path}.url invalid`);
	if (!isLogo(app.logo)) throw new Error(`${path}.logo invalid`);
	if (!isText(app.color) || !HEX_COLOR.test(app.color)) throw new Error(`${path}.color invalid`);
	if (typeof app.fullscreen !== 'boolean') throw new Error(`${path}.fullscreen invalid`);
	if (app.invert !== undefined && typeof app.invert !== 'boolean') throw new Error(`${path}.invert invalid`);
	if (app.scale !== undefined && (typeof app.scale !== 'number' || app.scale <= 0 || app.scale > 3)) {
		throw new Error(`${path}.scale invalid`);
	}
	return {
		id: app.id,
		name: app.name.trim(),
		url: app.url,
		logo: app.logo,
		color: app.color,
		fullscreen: app.fullscreen,
		...(app.invert ? { invert: true } : {}),
		...(app.scale !== undefined ? { scale: app.scale } : {}),
	};
}

/** Throws with a readable path when the payload is not a valid state document. */
export function validateState(value: unknown): DashboardState {
	const state = value as Record<string, unknown>;
	if (!state || typeof state !== 'object' || !Array.isArray(state.categories)) {
		throw new Error('categories missing');
	}
	if (state.categories.length > 100) throw new Error('too many categories');

	const ids = new Set<string>();
	const categories = state.categories.map((raw, ci) => {
		const cat = raw as Record<string, unknown>;
		const path = `categories[${ci}]`;
		if (!cat || typeof cat !== 'object') throw new Error(`${path}: not an object`);
		if (!isText(cat.id, 64) || !cat.id) throw new Error(`${path}.id invalid`);
		if (!isText(cat.name, 100) || !cat.name.trim()) throw new Error(`${path}.name invalid`);
		if (!Array.isArray(cat.apps) || cat.apps.length > 500) throw new Error(`${path}.apps invalid`);
		const apps = cat.apps.map((app, ai) => validateApp(app, `${path}.apps[${ai}]`));
		for (const id of [cat.id, ...apps.map((a) => a.id)]) {
			if (ids.has(id)) throw new Error(`duplicate id ${id}`);
			ids.add(id);
		}
		return { id: cat.id, name: cat.name.trim(), apps };
	});
	return { categories };
}

export const YOUTUBE_REDIRECT = 'https://www.youtube.com/redirect?q=';

/** Link target for a card: fullscreen apps go through Tesla's YouTube-redirect trick. */
export function launchHref(app: Pick<App, 'url' | 'fullscreen'>): string {
	return app.fullscreen ? `${YOUTUBE_REDIRECT}${encodeURIComponent(app.url)}` : app.url;
}

/** Adds https:// when missing; returns null for anything that is not a usable http(s) URL. */
export function normalizeUrl(raw: string): string | null {
	let target = raw.trim();
	if (!target) return null;
	if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
	try {
		const parsed = new URL(target);
		if (!parsed.hostname || /\s|%20/i.test(parsed.hostname)) return null;
		return parsed.href;
	} catch {
		return null;
	}
}
