import { describe, expect, it } from 'bun:test';
import { combinedState, distanceMeters, serviceFor } from './home';

describe('distanceMeters', () => {
	it('measures short distances', () => {
		const d = distanceMeters({ lat: 50.1, lon: 8.6 }, { lat: 50.1005, lon: 8.6005 });
		expect(d).toBeGreaterThan(60);
		expect(d).toBeLessThan(75);
	});
});

describe('serviceFor', () => {
	const garage = { id: 'garage', name: 'Garage', entity: 'cover.garagentor' };
	const light = { id: 'l', name: 'Licht', entity: 'light.x' };

	it('maps allowed actions per domain', () => {
		expect(serviceFor(garage, 'open')).toEqual({ domain: 'cover', service: 'open_cover' });
		expect(serviceFor(garage, 'close')).toEqual({ domain: 'cover', service: 'close_cover' });
		expect(serviceFor(light, 'toggle')).toEqual({ domain: 'light', service: 'toggle' });
	});

	it('refuses everything else', () => {
		expect(serviceFor(garage, 'toggle')).toBeNull();
		expect(serviceFor(light, 'open')).toBeNull();
		expect(serviceFor({ ...light, entity: 'lock.haustuer' }, 'toggle')).toBeNull();
	});
});

describe('combinedState', () => {
	it('is on only when all lamps are on, partial when some are', () => {
		expect(combinedState(['on', 'on'])).toBe('on');
		expect(combinedState(['off', 'on', 'off'])).toBe('partial');
		expect(combinedState(['on', 'unavailable'])).toBe('on');
		expect(combinedState(['off', 'unavailable'])).toBe('off');
		expect(combinedState(['unavailable', undefined])).toBe('unavailable');
		expect(combinedState(['closed'])).toBe('closed');
	});

	it('serviceFor works for entity lists', () => {
		expect(serviceFor({ entity: ['light.a', 'light.b'] }, 'toggle')).toEqual({ domain: 'light', service: 'toggle' });
	});
});
