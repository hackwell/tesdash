import { existsSync, readFileSync } from 'fs';
import { join, normalize } from 'path';
import sharp from 'sharp';
import { dominantColor } from '../src/lib/color';

/**
 * Accent color of a logo bundled under publicDir (used for the first seed only).
 * Remote logos are deliberately not fetched here: the browser computes their color itself,
 * so the server never makes outbound requests on a user's behalf.
 */
export async function extractColor(logo: string, publicDir: string, fallback = '#ffffff'): Promise<string> {
	if (!logo.startsWith('/')) return fallback;
	const fullPath = normalize(join(publicDir, logo));
	if (!fullPath.startsWith(publicDir) || !existsSync(fullPath)) return fallback;

	try {
		const { data } = await sharp(readFileSync(fullPath))
			.resize(64, 64, { fit: 'fill' })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		return dominantColor(data) ?? fallback;
	} catch {
		return fallback;
	}
}
