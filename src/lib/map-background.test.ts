import { describe, expect, it } from 'bun:test';
import { bearingDegrees, distanceMeters, headingOf, mapUrl, shouldRecenter, turnTowards } from './map-background';

describe('mapUrl', () => {
	it('builds a Waze embed URL at the rounded position, without the pin that would turn with the map', () => {
		const url = new URL(mapUrl({ lat: 49.123456, lon: 8.098765 }));
		expect(url.origin + url.pathname).toBe('https://embed.waze.com/iframe');
		expect(url.searchParams.get('lat')).toBe('49.1235');
		expect(url.searchParams.get('lon')).toBe('8.0988');
		expect(url.searchParams.get('zoom')).toBe('13');
		expect(url.searchParams.has('pin')).toBe(false);
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

describe('bearingDegrees', () => {
	it('points north, east, south and west', () => {
		const here = { lat: 49, lon: 8 };
		expect(bearingDegrees(here, { lat: 49.001, lon: 8 })).toBeCloseTo(0, 3);
		expect(bearingDegrees(here, { lat: 49, lon: 8.001 })).toBeCloseTo(90, 2);
		expect(bearingDegrees(here, { lat: 48.999, lon: 8 })).toBeCloseTo(180, 3);
		expect(bearingDegrees(here, { lat: 49, lon: 7.999 })).toBeCloseTo(270, 2);
	});
});

describe('headingOf', () => {
	const here = { lat: 49, lon: 8 };
	const eastBlock = { lat: 49, lon: 8.001 }; // ~73 m east

	it('uses the GPS heading while driving', () => {
		expect(headingOf({ heading: 123, speed: 10 }, here, here)).toBe(123);
	});

	it('ignores the heading when standing or crawling', () => {
		expect(headingOf({ heading: 123, speed: 0 }, here, eastBlock)).toBeNull();
		expect(headingOf({ heading: 123, speed: 1.5 }, here, eastBlock)).toBeNull();
		expect(headingOf({ heading: Number.NaN, speed: Number.NaN }, here, { lat: 49.0001, lon: 8 })).toBeNull();
	});

	it('derives the heading from the positions when the GPS gives none', () => {
		expect(headingOf({ heading: null, speed: null }, here, eastBlock)).toBeCloseTo(90, 2);
		expect(headingOf({ heading: Number.NaN, speed: 12 }, here, eastBlock)).toBeCloseTo(90, 2);
	});

	it('cannot derive a heading from the first fix', () => {
		expect(headingOf({ heading: null, speed: null }, null, here)).toBeNull();
	});
});

describe('turnTowards', () => {
	it('wraps around north the short way', () => {
		expect(turnTowards(350, 10)).toBe(370);
		expect(turnTowards(10, 350)).toBe(-10);
		expect(turnTowards(-10, 20)).toBe(20);
		expect(turnTowards(725, 0)).toBe(720);
	});

	it('turns the short way on a U-turn and in sharp curves', () => {
		expect(turnTowards(0, 270)).toBe(-90);
		expect(turnTowards(90, 260)).toBe(260);
	});

	it('ignores wobble of a few degrees', () => {
		expect(turnTowards(90, 92)).toBe(90);
		expect(turnTowards(358, 1)).toBe(358);
	});
});
