// Home Assistant bridge: exposes only the entities listed in the home config, never a generic HA proxy.
import { existsSync, readFileSync } from 'fs';

const HA_TIMEOUT_MS = 5_000;
const HOME_CACHE_MS = 60 * 60 * 1000;

export interface Tile {
	id: string;
	name: string;
	/** One entity, or several of the same domain switched together (each addressed directly, no Zigbee group). */
	entity: string | string[];
	/** Extra data for light.turn_on, e.g. the colour the wall switch uses. */
	onData?: Record<string, unknown>;
	/** Require a long press before the action fires. */
	hold?: boolean;
	/** Only act when this device tracker (the car, read from HA on the server) is within geofenceMeters of HA's home. */
	geofenceTracker?: string;
	geofenceMeters?: number;
	/** Icon key, see src/lib/icons.ts. */
	icon?: string;
	/** Only show the tile while the sun is below the horizon (HA's sun.sun). */
	onlyWhenDark?: boolean;
}

export interface HomeConfig {
	tiles: Tile[];
}

export type TileAction = 'open' | 'close' | 'toggle';

const SERVICES: Record<string, Partial<Record<TileAction, string>>> = {
	cover: { open: 'open_cover', close: 'close_cover' },
	light: { toggle: 'toggle' },
	switch: { toggle: 'toggle' },
};

export class HomeError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export function entitiesOf(tile: Pick<Tile, 'entity'>): string[] {
	return Array.isArray(tile.entity) ? tile.entity : [tile.entity];
}

export function domainOf(tile: Pick<Tile, 'entity'>): string {
	return entitiesOf(tile)[0].split('.')[0];
}

/**
 * Several entities: 'on' only when all available ones are on, 'partial' when some are, 'unavailable' when none
 * answers. So switching one floodlight on its own does not make the whole group look on.
 */
export function combinedState(states: (string | undefined)[]): string {
	if (states.length === 1) return states[0] ?? 'unavailable';
	const available = states.filter((s): s is string => s !== undefined && s !== 'unavailable');
	if (!available.length) return 'unavailable';
	const on = available.filter((s) => s === 'on').length;
	return on === 0 ? 'off' : on === available.length ? 'on' : 'partial';
}

export function loadHomeConfig(path: string): HomeConfig | null {
	if (!existsSync(path)) return null;
	const raw = JSON.parse(readFileSync(path, 'utf-8')) as HomeConfig;
	for (const tile of raw.tiles ?? []) {
		const domain = domainOf(tile);
		if (!SERVICES[domain] || entitiesOf(tile).some((e) => e.split('.')[0] !== domain)) {
			throw new Error(`home config: ${tile.id} has unsupported or mixed entities`);
		}
		if (!!tile.geofenceMeters !== !!tile.geofenceTracker) {
			throw new Error(`home config: ${tile.id} needs both geofenceTracker and geofenceMeters`);
		}
	}
	return { tiles: raw.tiles ?? [] };
}

/** Great-circle distance in meters. */
export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const rad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function serviceFor(tile: Pick<Tile, 'entity'>, action: TileAction): { domain: string; service: string } | null {
	const domain = domainOf(tile);
	const service = SERVICES[domain]?.[action];
	return service ? { domain, service } : null;
}

interface HaState {
	entity_id: string;
	state: string;
	attributes: Record<string, unknown>;
}

export function createHome(config: HomeConfig, haUrl: string, haToken: string) {
	let home: { lat: number; lon: number; at: number } | null = null;

	async function ha(path: string, init: RequestInit = {}): Promise<unknown> {
		const res = await fetch(`${haUrl}/api/${path}`, {
			...init,
			headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' },
			signal: AbortSignal.timeout(HA_TIMEOUT_MS),
		});
		if (!res.ok) throw new HomeError(`Home Assistant HTTP ${res.status}`, 502);
		return res.json();
	}

	async function homeLocation(): Promise<{ lat: number; lon: number }> {
		if (!home || Date.now() - home.at > HOME_CACHE_MS) {
			const cfg = (await ha('config')) as { latitude: number; longitude: number };
			home = { lat: cfg.latitude, lon: cfg.longitude, at: Date.now() };
		}
		return home;
	}

	/** Unknown sun state counts as dark, so a broken sun entity never hides the lights. */
	function isDark(sun: HaState | undefined): boolean {
		return sun?.state !== 'above_horizon';
	}

	async function snapshot() {
		const entities = new Set([...config.tiles.flatMap(entitiesOf), 'sun.sun']);
		let states = new Map<string, HaState>();
		let reachable = true;
		try {
			const all = (await ha('states')) as HaState[];
			states = new Map(all.filter((s) => entities.has(s.entity_id)).map((s) => [s.entity_id, s]));
		} catch {
			reachable = false;
		}
		return {
			enabled: true,
			reachable,
			tiles: config.tiles.filter((tile) => !tile.onlyWhenDark || isDark(states.get('sun.sun'))).map((tile) => ({
				id: tile.id,
				name: tile.name,
				domain: domainOf(tile),
				state: combinedState(entitiesOf(tile).map((e) => states.get(e)?.state)),
				hold: !!tile.hold,
				icon: tile.icon ?? '',
			})),
		};
	}

	/** The car's position comes from Home Assistant, never from the browser, so it cannot be spoofed by a client. */
	async function trackerDistance(tracker: string): Promise<number | null> {
		const state = (await ha(`states/${tracker}`)) as HaState;
		const lat = Number(state.attributes.latitude);
		const lon = Number(state.attributes.longitude);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
		return distanceMeters({ lat, lon }, await homeLocation());
	}

	async function act(tileId: string, action: TileAction): Promise<void> {
		const tile = config.tiles.find((t) => t.id === tileId);
		if (!tile) throw new HomeError('unknown tile', 404);
		const target = serviceFor(tile, action);
		if (!target) throw new HomeError('action not allowed', 400);

		if (tile.geofenceTracker && tile.geofenceMeters) {
			const distance = await trackerDistance(tile.geofenceTracker);
			if (distance === null || distance > tile.geofenceMeters) {
				// Distance stays in the server log only; the client learns nothing about the home location.
				console.log(`[home] ${tile.id}: refused, car distance ${distance === null ? 'unknown' : `${Math.round(distance)} m`}`);
				throw new HomeError('car not at home', 403);
			}
		}

		let service = target.service;
		let data: Record<string, unknown> = {};
		if (action === 'toggle') {
			// Explicit on/off keeps several lamps in step (a plain toggle would flip each one separately):
			// all on → all off, otherwise (none or some on) → all on.
			const current = await Promise.all(entitiesOf(tile).map(async (e) => ((await ha(`states/${e}`)) as HaState).state));
			service = combinedState(current) === 'on' ? 'turn_off' : 'turn_on';
			if (service === 'turn_on' && target.domain === 'light') data = tile.onData ?? {};
		}

		await ha(`services/${target.domain}/${service}`, {
			method: 'POST',
			body: JSON.stringify({ ...data, entity_id: entitiesOf(tile).length === 1 ? entitiesOf(tile)[0] : entitiesOf(tile) }),
		});
		console.log(`[home] ${tile.id}: ${target.domain}.${service}`);
	}

	return { snapshot, act };
}
