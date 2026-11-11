// Live Waze map behind the dashboard, centred on the car's GPS position.
// The embed has no API to pan, so it is reloaded when the car has moved far enough: the new map loads behind the
// visible one and replaces it once loaded, so the background never flashes empty.

const EMBED_URL = 'https://embed.waze.com/iframe';
const ZOOM = 13;
// About 4 px at zoom 13: small enough to keep the car centred, large enough to skip GPS jitter while parked.
const RECENTER_METERS = 50;
// A reload costs a full embed load on a 2 GB device, so at most one every 10 s (about 140 m at 50 km/h).
const RECENTER_MIN_MS = 10_000;

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

	navigator.geolocation.watchPosition(
		({ coords }) => {
			const next = { lat: coords.latitude, lon: coords.longitude };
			const now = Date.now();
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
