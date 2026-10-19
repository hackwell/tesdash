import { describe, expect, it } from 'bun:test';
import { distanceMeters, serviceFor } from './home';

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
