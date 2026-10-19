// Logo suggestions for a pasted app URL. Everything is loaded by the browser, the server never fetches
// third-party URLs. Simple Icons and icon.horse send CORS headers, so the card colour can be read from them.
import { normalizeUrl } from './state';

const LOAD_TIMEOUT_MS = 5_000;
const MIN_SIZE_PX = 32;
// Leading labels that say nothing about the brand: www.netflix.com, app.plex.tv, play.geforcenow.com …
const NOISE_LABELS = new Set(['www', 'm', 'app', 'apps', 'web', 'play', 'open', 'my', 'login', 'portal', 'home']);

export interface LogoCandidate {
	url: string;
	source: string;
}

export function slugify(text: string): string {
	return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/** Brand guesses from the host and the typed name: tv.apple.com → apple, appletv, tvapple. */
export function brandSlugs(rawUrl: string, name = ''): string[] {
	const slugs: string[] = [];
	const nameSlug = slugify(name);
	if (nameSlug) slugs.push(nameSlug);

	const url = normalizeUrl(rawUrl);
	if (url) {
		const labels = new URL(url).hostname.split('.');
		const brand = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
		const sub = labels.length >= 3 ? labels[labels.length - 3] : '';
		slugs.push(slugify(brand));
		if (sub && !NOISE_LABELS.has(sub)) slugs.push(slugify(brand + sub), slugify(sub + brand));
	}
	return [...new Set(slugs.filter((s) => s.length >= 2))];
}

export function hostOf(rawUrl: string): string | null {
	const url = normalizeUrl(rawUrl);
	return url ? new URL(url).hostname.replace(/^www\./, '') : null;
}

/** Candidate logos in order of expected quality; most will be filtered out by actually loading them. */
export function logoCandidates(rawUrl: string, name: string, bundled: string[]): LogoCandidate[] {
	const slugs = brandSlugs(rawUrl, name);
	const host = hostOf(rawUrl);
	const out: LogoCandidate[] = [];

	for (const file of bundled) {
		const base = slugify(file.split('/').pop()!.replace(/\.[a-z0-9]+$/i, ''));
		if (slugs.some((s) => base === s || base.startsWith(s) || s.startsWith(base))) out.push({ url: file, source: 'Mitgeliefert' });
	}
	for (const slug of slugs) {
		out.push({ url: `https://cdn.simpleicons.org/${slug}`, source: 'Simple Icons' });
		out.push({ url: `https://cdn.simpleicons.org/${slug}/white`, source: 'Simple Icons (weiß)' });
	}
	if (host) {
		out.push({ url: `https://icon.horse/icon/${host}`, source: 'Website-Icon' });
		out.push({ url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`, source: 'Favicon' });
	}
	return out.filter((c, i) => out.findIndex((o) => o.url === c.url) === i);
}

/** Resolves true when the image loads and is big enough to look good on a card. */
export function loads(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		const img = new Image();
		const timer = setTimeout(() => resolve(false), LOAD_TIMEOUT_MS);
		img.onload = () => {
			clearTimeout(timer);
			// SVGs report their intrinsic size, which can be small but scale perfectly.
			resolve(url.includes('simpleicons') || url.endsWith('.svg') || Math.min(img.naturalWidth, img.naturalHeight) >= MIN_SIZE_PX);
		};
		img.onerror = () => {
			clearTimeout(timer);
			resolve(false);
		};
		img.src = url;
	});
}

export async function findLogos(rawUrl: string, name: string, bundled: string[], max = 6): Promise<LogoCandidate[]> {
	const candidates = logoCandidates(rawUrl, name, bundled);
	const ok = await Promise.all(candidates.map((c) => loads(c.url)));
	return candidates.filter((_, i) => ok[i]).slice(0, max);
}
