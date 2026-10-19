import { describe, expect, it } from 'bun:test';
import { launchHref, normalizeUrl, validateState } from './state';

const app = { id: 'a1', name: 'Netflix', url: 'https://www.netflix.com', logo: '/logos/netflix.svg', color: '#e50914', fullscreen: true };
const state = (apps: unknown[] = [app]) => ({ categories: [{ id: 'c1', name: 'Streaming', apps }] });

describe('validateState', () => {
	it('accepts a valid document and drops unknown fields', () => {
		const result = validateState({ ...state([{ ...app, extra: 'x' }]), revision: 3 });
		expect(result as unknown).toEqual(state());
	});

	it.each([
		['javascript URL', { url: 'javascript:alert(1)' }],
		['logo outside /logos', { logo: '../secret.png' }],
		['bad color', { color: 'red' }],
		['empty name', { name: '  ' }],
		['missing fullscreen', { fullscreen: undefined }],
		['scale out of range', { scale: 10 }],
	])('rejects %s', (_label, patch) => {
		expect(() => validateState(state([{ ...app, ...patch }]))).toThrow();
	});

	it('rejects duplicate ids', () => {
		expect(() => validateState(state([app, { ...app }]))).toThrow('duplicate id a1');
	});

	it('rejects a document without categories', () => {
		expect(() => validateState({})).toThrow('categories missing');
	});
});

describe('normalizeUrl', () => {
	it('adds https and keeps valid URLs', () => {
		expect(normalizeUrl('ha.example.com')).toBe('https://ha.example.com/');
		expect(normalizeUrl('http://10.10.10.228:8123')).toBe('http://10.10.10.228:8123/');
	});

	it('rejects empty and malformed input', () => {
		expect(normalizeUrl('  ')).toBeNull();
		expect(normalizeUrl('https://not a url')).toBeNull();
	});
});

describe('launchHref', () => {
	it('wraps fullscreen apps in the YouTube redirect', () => {
		expect(launchHref({ url: 'https://x.test/', fullscreen: true })).toBe('https://www.youtube.com/redirect?q=https%3A%2F%2Fx.test%2F');
		expect(launchHref({ url: 'https://x.test/', fullscreen: false })).toBe('https://x.test/');
	});
});
