import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPairing, DEVICE_COOKIE, newCode, parseCookies } from './pairing';

const fresh = () => createPairing(join(mkdtempSync(join(tmpdir(), 'pair-')), 'devices.json'));

describe('pairing', () => {
	it('codes are easy to compare (no 0/O/1/I)', () => {
		for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
	});

	it('start → approve → poll hands out the device token exactly once', () => {
		const p = fresh();
		const { ref, code, pollToken } = p.start('1.2.3.4', 'TeslaBrowser')!;
		expect(p.poll(pollToken)).toBe('pending');
		expect(p.describe(ref)).toMatchObject({ userAgent: 'TeslaBrowser' });
		const deviceToken = p.approve(ref, code.toLowerCase(), 'Model Y', 'akadmin');
		expect(deviceToken).toBeString();
		expect(p.poll(pollToken)).toEqual({ deviceToken: deviceToken! });
		expect(p.poll(pollToken)).toBe('expired');
		expect(p.authenticate(`${DEVICE_COOKIE}=${encodeURIComponent(deviceToken!)}`)?.name).toBe('Model Y');
	});

	it('refuses unknown pairings, wrong codes, double approval and foreign poll tokens', () => {
		const p = fresh();
		const { ref, code } = p.start('1.2.3.4', '')!;
		expect(p.approve('unknown', code, 'x', 'akadmin')).toBeNull();
		expect(p.approve(ref, 'ZZZZ' === code ? 'YYYY' : 'ZZZZ', 'x', 'akadmin')).toBe('wrong-code');
		expect(p.poll('not-the-token')).toBe('expired');
		expect(p.approve(ref, code, 'x', 'akadmin')).toBeString();
		expect(p.approve(ref, code, 'x', 'akadmin')).toBeNull();
	});

	it('drops a pairing after five wrong codes', () => {
		const p = fresh();
		const { ref, code } = p.start('1.2.3.4', '')!;
		const wrong = code === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
		for (let i = 0; i < 5; i++) expect(p.approve(ref, wrong, 'x', 'akadmin')).toBe('wrong-code');
		expect(p.approve(ref, code, 'x', 'akadmin')).toBeNull();
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

	it('rate-limits pairing starts per client, not globally', () => {
		const p = fresh();
		const flood = Array.from({ length: 8 }, () => p.start('6.6.6.6', ''));
		expect(flood.filter(Boolean)).toHaveLength(5);
		expect(p.start('1.2.3.4', '')).not.toBeNull();
	});

	it('a flood from many IPs evicts old pairings but never blocks new ones', () => {
		const p = fresh();
		for (let i = 0; i < 150; i++) p.start(`10.0.${Math.floor(i / 250)}.${i % 250}`, '');
		expect(p.start('1.2.3.4', '')).not.toBeNull();
	});
});

describe('parseCookies', () => {
	it('parses a cookie header', () => {
		expect(parseCookies('a=1; tesla_device=x%3Dy; b=')).toEqual({ a: '1', tesla_device: 'x=y', b: '' });
		expect(parseCookies(null)).toEqual({});
	});
});
