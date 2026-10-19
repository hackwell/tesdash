// Home Assistant bridge: exposes only the entities listed in the home config, never a generic HA proxy.
import { existsSync, readFileSync } from 'fs';

const HA_TIMEOUT_MS = 5_000;
const HOME_CACHE_MS = 60 * 60 * 1000;

export interface StatusItem {
	label: string;
	entity: string;
	/** Read this attribute instead of the state, e.g. `temperature` of a weather entity. */
	attribute?: string;
	unit?: string;
	decimals?: number;
	icon?: string;
}

export interface Tile {
	id: string;
	name: string;
	entity: string;
	/** Require a long press before the action fires. */
	hold?: boolean;
	/** Only act when this device tracker (the car, read from HA on the server) is within geofenceMeters of HA's home. */
	geofenceTracker?: string;
	geofenceMeters?: number;
	/** Icon key, see src/lib/icons.ts. */
	icon?: string;
}

export interface HomeConfig {
	status: StatusItem[];
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

export function loadHomeConfig(path: string): HomeConfig | null {
	if (!existsSync(path)) return null;
	const raw = JSON.parse(readFileSync(path, 'utf-8')) as HomeConfig;
	for (const tile of raw.tiles ?? []) {
		const domain = tile.entity.split('.')[0];
		if (!SERVICES[domain]) throw new Error(`home config: unsupported entity ${tile.entity}`);
		if (!!tile.geofenceMeters !== !!tile.geofenceTracker) {
			throw new Error(`home config: ${tile.id} needs both geofenceTracker and geofenceMeters`);
		}
	}
	return { status: raw.status ?? [], tiles: raw.tiles ?? [] };
}

/** Great-circle distance in meters. */
export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const rad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function serviceFor(tile: Tile, action: TileAction): { domain: string; service: string } | null {
	const domain = tile.entity.split('.')[0];
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

	function formatStatus(item: StatusItem, state: HaState | undefined): string | null {
		if (!state) return null;
		const raw = item.attribute ? state.attributes[item.attribute] : state.state;
		if (raw === undefined || raw === null || raw === 'unavailable' || raw === 'unknown') return null;
		const num = Number(raw);
		return item.decimals !== undefined && Number.isFinite(num) ? num.toFixed(item.decimals) : String(raw);
	}

	async function snapshot() {
		const entities = new Set([...config.status.map((s) => s.entity), ...config.tiles.map((t) => t.entity)]);
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
			status: config.status.map((item) => ({
				label: item.label,
				icon: item.icon ?? '',
				value: formatStatus(item, states.get(item.entity)),
				unit: item.unit ?? '',
			})),
			tiles: config.tiles.map((tile) => ({
				id: tile.id,
				name: tile.name,
				domain: tile.entity.split('.')[0],
				state: states.get(tile.entity)?.state ?? 'unavailable',
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

		await ha(`services/${target.domain}/${target.service}`, {
			method: 'POST',
			body: JSON.stringify({ entity_id: tile.entity }),
		});
		console.log(`[home] ${tile.id}: ${target.domain}.${target.service}`);
	}

	return { snapshot, act };
}
