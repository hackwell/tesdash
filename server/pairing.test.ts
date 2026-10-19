import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPairing, DEVICE_COOKIE, newCode, parseCookies } from './pairing';

const fresh = () => createPairing(join(mkdtempSync(join(tmpdir(), 'pair-')), 'devices.json'));

describe('pairing', () => {
	it('codes are easy to compare (no 0/O/1/I)', () => {
		for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
	});

	it('start → approve → poll hands out the device token exactly once', () => {
		const p = fresh();
		const { code, pollToken } = p.start()!;
		expect(p.poll(pollToken)).toBe('pending');
		const deviceToken = p.approve(code.toLowerCase(), 'Model Y', 'akadmin');
		expect(deviceToken).toBeString();
		expect(p.poll(pollToken)).toEqual({ deviceToken: deviceToken! });
		expect(p.poll(pollToken)).toBe('expired');
		expect(p.authenticate(`${DEVICE_COOKIE}=${encodeURIComponent(deviceToken!)}`)?.name).toBe('Model Y');
	});

	it('refuses unknown codes, double approval and foreign poll tokens', () => {
		const p = fresh();
		const { code } = p.start()!;
		expect(p.approve('AAAA-BBBB', 'x', 'akadmin')).toBeNull();
		expect(p.poll('not-the-token')).toBe('expired');
		expect(p.approve(code, 'x', 'akadmin')).toBeString();
		expect(p.approve(code, 'x', 'akadmin')).toBeNull();
	});

	it('stores only token hashes and revokes devices', () => {
		const file = join(mkdtempSync(join(tmpdir(), 'pair-')), 'devices.json');
		const p = createPairing(file);
		const token = p.issueDevice('Mac', 'akadmin');
		expect(readFileSync(file, 'utf-8')).not.toContain(token);
		const [device] = p.list();
		expect(device).not.toHaveProperty('tokenHash');
		expect(p.revoke(device.id)).toBe(true);
		expect(p.authenticate(`${DEVICE_COOKIE}=${token}`)).toBeNull();
	});

	it('rate-limits pairing starts', () => {
		const p = fresh();
		const started = Array.from({ length: 12 }, () => p.start());
		expect(started.filter(Boolean)).toHaveLength(10);
	});
});

describe('parseCookies', () => {
	it('parses a cookie header', () => {
		expect(parseCookies('a=1; tesla_device=x%3Dy; b=')).toEqual({ a: '1', tesla_device: 'x=y', b: '' });
		expect(parseCookies(null)).toEqual({});
	});
});
