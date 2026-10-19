// Picks a card accent color from logo pixels. Shared by the server seed (sharp) and the browser (canvas).

function getSaturation(r: number, g: number, b: number): number {
	const rn = r / 255, gn = g / 255, bn = b / 255;
	const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return 0;
	const d = max - min;
	return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/** Most saturated mid-lightness opaque pixel of RGBA data, or null when there is none. */
export function dominantColor(rgba: ArrayLike<number>): string | null {
	let best: [number, number, number] | null = null;
	let bestScore = -1;

	for (let i = 0; i < rgba.length; i += 4) {
		const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
		if (a < 128) continue;

		const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
		if (l < 0.15 || l > 0.92) continue;

		const s = getSaturation(r, g, b);
		if (s > bestScore) {
			bestScore = s;
			best = [r, g, b];
		}
	}

	return best && `#${best.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
