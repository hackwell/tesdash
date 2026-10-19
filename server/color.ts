import { existsSync, readFileSync } from 'fs';
import { join, normalize } from 'path';
import sharp from 'sharp';

const FETCH_TIMEOUT_MS = 5_000;

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
			const res = await fetch(logo, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (!res.ok) return null;
			return Buffer.from(await res.arrayBuffer());
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
		const { data } = await sharp(buffer)
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
