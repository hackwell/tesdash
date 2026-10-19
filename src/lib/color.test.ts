import { describe, expect, it } from 'bun:test';
import { dominantColor } from './color';

describe('dominantColor', () => {
	it('picks the most saturated opaque mid-lightness pixel', () => {
		const pixels = [
			200, 200, 200, 255, // grey
			229, 9, 20, 255, // red
			10, 200, 10, 0, // transparent green, ignored
		];
		expect(dominantColor(pixels)).toBe('#e50914');
	});

	it('returns null when only black, white or transparent pixels exist', () => {
		expect(dominantColor([0, 0, 0, 255, 255, 255, 255, 255, 229, 9, 20, 0])).toBeNull();
	});
});
