// Live Waze map behind the dashboard, centred on the car's GPS position.
// The embed has no API to pan, so the iframe is reloaded when the car has moved far enough.

const EMBED_URL = 'https://embed.waze.com/iframe';
const ZOOM = 13;
const RECENTER_METERS = 1500;
const RECENTER_MIN_MS = 60_000;

export interface Position {
	lat: number;
	lon: number;
}

export function mapUrl({ lat, lon }: Position, zoom = ZOOM): string {
	const url = new URL(EMBED_URL);
	url.searchParams.set('zoom', String(zoom));
	url.searchParams.set('lat', lat.toFixed(4));
	url.searchParams.set('lon', lon.toFixed(4));
	url.searchParams.set('pin', '1');
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

export function initMapBackground(): void {
	const frame = document.getElementById('bg-map') as HTMLIFrameElement | null;
	if (!frame || !('geolocation' in navigator)) return;

	let last: Position | null = null;
	let lastAt = 0;

	navigator.geolocation.watchPosition(
		({ coords }) => {
			const next = { lat: coords.latitude, lon: coords.longitude };
			const now = Date.now();
			if (!shouldRecenter(last, lastAt, next, now)) return;
			frame.src = mapUrl(next);
			frame.hidden = false;
			last = next;
			lastAt = now;
		},
		// No position (denied or unavailable): keep the plain dark background.
		() => {},
		{ enableHighAccuracy: false, maximumAge: 30_000 },
	);
}
