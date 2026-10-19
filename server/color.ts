import { lookup } from 'dns/promises';
import { existsSync, readFileSync } from 'fs';
import { BlockList, isIP } from 'net';
import { join, normalize } from 'path';
import sharp from 'sharp';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_PIXELS = 4096 * 4096;

// Logos are fetched server side, so internal networks (Docker, LAN, Tailscale) must stay unreachable.
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are matched by the IPv4 rules; a ::ffff:0:0/96 rule would block all IPv4.
const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
	['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]] as const) {
	blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
	blocked.addSubnet(net, prefix, 'ipv6');
}

export async function isPublicHost(hostname: string): Promise<boolean> {
	const host = hostname.replace(/^\[|\]$/g, '');
	try {
		const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
		return addresses.length > 0 && addresses.every(({ address, family }) => !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4'));
	} catch {
		return false;
	}
}

async function fetchRemoteLogo(url: string): Promise<Buffer | null> {
	const parsed = new URL(url);
	if (!(await isPublicHost(parsed.hostname))) return null;
	// No redirects: every hop would need the same host check.
	const res = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok || !res.body) return null;
	if (Number(res.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES) return null;

	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of res.body) {
		size += chunk.byteLength;
		if (size > MAX_LOGO_BYTES) return null;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

function getSaturation(r: number, g: number, b: number): number {
	const rn = r / 255, gn = g / 255, bn = b / 255;
	const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return 0;
	const d = max - min;
	return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

async function getImageBuffer(logo: string, publicDir: string): Promise<Buffer | null> {
	if (logo.startsWith('http://') || logo.startsWith('https://')) {
		try {
			return await fetchRemoteLogo(logo);
		} catch {
			return null;
		}
	}
	const fullPath = normalize(join(publicDir, logo));
	if (!fullPath.startsWith(normalize(publicDir)) || !existsSync(fullPath)) return null;
	return readFileSync(fullPath);
}

/** Most saturated mid-lightness pixel of the logo, or the fallback when the logo cannot be read. */
export async function extractColor(logo: string, publicDir: string, fallback = '#ffffff'): Promise<string> {
	if (!logo) return fallback;
	const buffer = await getImageBuffer(logo, publicDir);
	if (!buffer) return fallback;

	try {
		const { data } = await sharp(buffer, { limitInputPixels: MAX_LOGO_PIXELS })
			.resize(64, 64, { fit: 'fill' })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		let bestR = 128, bestG = 128, bestB = 128, bestScore = -1;

		for (let i = 0; i < data.length; i += 4) {
			const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
			if (a < 128) continue;

			const rn = r / 255, gn = g / 255, bn = b / 255;
			const l = (Math.max(rn, gn, bn) + Math.min(rn, gn, bn)) / 2;
			if (l < 0.15 || l > 0.92) continue;

			const s = getSaturation(r, g, b);
			if (s > bestScore) {
				bestScore = s;
				bestR = r; bestG = g; bestB = b;
			}
		}

		if (bestScore < 0) return fallback;
		return `#${[bestR, bestG, bestB].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
	} catch {
		return fallback;
	}
}
