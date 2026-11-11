import { describe, expect, it } from 'bun:test';
import { distanceMeters, mapUrl, shouldRecenter } from './map-background';

describe('mapUrl', () => {
	it('builds a Waze embed URL with a pin at the rounded position', () => {
		const url = new URL(mapUrl({ lat: 49.123456, lon: 8.098765 }));
		expect(url.origin + url.pathname).toBe('https://embed.waze.com/iframe');
		expect(url.searchParams.get('lat')).toBe('49.1235');
		expect(url.searchParams.get('lon')).toBe('8.0988');
		expect(url.searchParams.get('zoom')).toBe('13');
		expect(url.searchParams.get('pin')).toBe('1');
	});
});

describe('distanceMeters', () => {
	it('measures about 111 km per degree of latitude', () => {
		expect(distanceMeters({ lat: 49, lon: 8 }, { lat: 50, lon: 8 })).toBeCloseTo(111_195, -2);
	});

	it('is zero for the same point', () => {
		expect(distanceMeters({ lat: 49, lon: 8 }, { lat: 49, lon: 8 })).toBe(0);
	});
});

describe('shouldRecenter', () => {
	const home = { lat: 49, lon: 8 };
	const block = { lat: 49.001, lon: 8 }; // ~110 m north

	it('always centres the first fix', () => {
		expect(shouldRecenter(null, 0, home, 1_000)).toBe(true);
	});

	it('ignores GPS jitter below 50 m', () => {
		expect(shouldRecenter(home, 0, { lat: 49.0003, lon: 8 }, 120_000)).toBe(false);
	});

	it('waits at least 10 s between reloads', () => {
		expect(shouldRecenter(home, 100_000, block, 109_000)).toBe(false);
	});

	it('follows the car after a street block of driving', () => {
		expect(shouldRecenter(home, 0, block, 10_000)).toBe(true);
	});
});
