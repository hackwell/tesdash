import { describe, expect, it } from 'bun:test';
import { brandSlugs, logoCandidates } from './logo-suggest';

describe('brandSlugs', () => {
	it('guesses the brand from the host and the name', () => {
		expect(brandSlugs('https://www.netflix.com/browse')).toEqual(['netflix']);
		expect(brandSlugs('tv.apple.com')).toEqual(['apple', 'appletv', 'tvapple']);
		expect(brandSlugs('play.geforcenow.com')).toEqual(['geforcenow']);
		expect(brandSlugs('ha.example.com', 'Home Assistant')).toEqual(['homeassistant', 'example', 'exampleha', 'haexample']);
		expect(brandSlugs('not a url')).toEqual([]);
	});
});

describe('logoCandidates', () => {
	it('prefers bundled logos, then Simple Icons, then site icons', () => {
		const list = logoCandidates('https://www.netflix.com', '', ['/logos/netflix.svg', '/logos/hbo.svg']);
		expect(list.map((c) => c.url)).toEqual([
			'/logos/netflix.svg',
			'https://cdn.simpleicons.org/netflix',
			'https://cdn.simpleicons.org/netflix/white',
			'https://icon.horse/icon/netflix.com',
			'https://www.google.com/s2/favicons?domain=netflix.com&sz=128',
		]);
	});
});
