// Live Waze map behind the dashboard, centred on the car's GPS position and turned heading-up.
// The embed has no API to pan, so it is reloaded when the car has moved far enough: the new map loads behind the
// visible one and replaces it once loaded, so the background never flashes empty.
// The embed is always north-up and has no rotation parameter, so the iframe itself is rotated with CSS around the
// car's position (its centre); our own car marker sits on top and keeps pointing up.

const EMBED_URL = 'https://embed.waze.com/iframe';
const ZOOM = 13;
// About 4 px at zoom 13: small enough to keep the car centred, large enough to skip GPS jitter while parked.
const RECENTER_METERS = 50;
// A reload costs a full embed load on a 2 GB device, so at most one every 10 s (about 140 m at 50 km/h).
const RECENTER_MIN_MS = 10_000;
// Below ~7 km/h the GPS heading is mostly noise (and undefined when standing), so the map keeps its direction.
const MIN_HEADING_SPEED_MPS = 2;
// Without a GPS heading, the direction is derived from two fixes at least this far apart (GPS jitter is ~5–10 m).
const MIN_BEARING_METERS = 20;
// Smaller heading changes are not worth turning the whole map for (straight-road wobble).
const MIN_TURN_DEGREES = 4;

export interface Position {
	lat: number;
	lon: number;
}

export function mapUrl({ lat, lon }: Position, zoom = ZOOM): string {
	const url = new URL(EMBED_URL);
	url.searchParams.set('zoom', String(zoom));
	url.searchParams.set('lat', lat.toFixed(4));
	url.searchParams.set('lon', lon.toFixed(4));
	return url.toString();
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Position, b: Position): number {
	const rad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function shouldRecenter(last: Position | null, lastAt: number, next: Position, now: number): boolean {
	if (!last) return true;
	return now - lastAt >= RECENTER_MIN_MS && distanceMeters(last, next) >= RECENTER_METERS;
}

/** Initial bearing from `a` to `b` in degrees clockwise from north, 0 ≤ result < 360. */
export function bearingDegrees(a: Position, b: Position): number {
	const rad = (deg: number) => (deg * Math.PI) / 180;
	const dLon = rad(b.lon - a.lon);
	const y = Math.sin(dLon) * Math.cos(rad(b.lat));
	const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface Motion {
	/** GPS heading in degrees from north; null or NaN when unknown or standing. */
	heading: number | null;
	/** Speed in m/s; null or NaN when unknown. */
	speed: number | null;
}

/**
 * The car's heading in degrees, or null when it cannot be trusted: standing or crawling, or (without a GPS heading)
 * not moved far enough from `from` to derive one.
 */
export function headingOf({ heading, speed }: Motion, from: Position | null, to: Position): number | null {
	if (speed != null && Number.isFinite(speed) && speed < MIN_HEADING_SPEED_MPS) return null;
	if (heading != null && Number.isFinite(heading)) return heading;
	if (!from || distanceMeters(from, to) < MIN_BEARING_METERS) return null;
	return bearingDegrees(from, to);
}

/**
 * Turns the unwrapped map heading `current` (any number of degrees, not limited to 0–360) towards `heading` the short
 * way round, e.g. 350 → 10 becomes 350 → 370, so the CSS transition never spins the map almost a full turn.
 */
export function turnTowards(current: number, heading: number): number {
	const delta = ((((heading - current) % 360) + 540) % 360) - 180;
	return Math.abs(delta) < MIN_TURN_DEGREES ? current : current + delta;
}

/** Loads `url` into a copy of `visible` placed underneath it; the copy replaces `visible` once loaded. */
function loadBehind(visible: HTMLIFrameElement, url: string): HTMLIFrameElement {
	const next = visible.cloneNode() as HTMLIFrameElement;
	next.removeAttribute('id');
	next.src = url;
	// Earlier in the DOM at the same z-index → painted below the visible map until that one is removed.
	visible.before(next);
	return next;
}

export function initMapBackground(): void {
	let frame = document.getElementById('bg-map') as HTMLIFrameElement | null;
	if (!frame || !('geolocation' in navigator)) return;

	let last: Position | null = null;
	let lastAt = 0;
	let pending: HTMLIFrameElement | null = null;
	// Where the current heading was taken; the next derived heading is measured from here.
	let headingFrom: Position | null = null;
	let mapHeading = 0;

	navigator.geolocation.watchPosition(
		({ coords }) => {
			const next = { lat: coords.latitude, lon: coords.longitude };
			const now = Date.now();
			const heading = headingOf(coords, headingFrom, next);
			if (heading !== null) {
				mapHeading = turnTowards(mapHeading, heading);
				// The map turns against the car's heading so the direction of travel points up.
				document.documentElement.style.setProperty('--map-rotation', `${(-mapHeading).toFixed(1)}deg`);
			}
			if (heading !== null || !headingFrom) headingFrom = next;
			if (!frame || !shouldRecenter(last, lastAt, next, now)) return;
			if (frame.hidden) {
				frame.src = mapUrl(next);
				frame.hidden = false;
			} else {
				// A load that never finished (e.g. offline) is superseded rather than stacked up.
				pending?.remove();
				const loading = loadBehind(frame, mapUrl(next));
				pending = loading;
				loading.addEventListener('load', () => {
					if (pending !== loading) return;
					frame?.remove();
					loading.id = 'bg-map';
					frame = loading;
					pending = null;
				});
			}
			last = next;
			lastAt = now;
		},
		// No position (denied or unavailable): keep the plain dark background.
		() => {},
		{ enableHighAccuracy: false, maximumAge: 30_000 },
	);
}
