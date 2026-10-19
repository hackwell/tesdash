import { describe, expect, it } from 'bun:test';
import { isPublicHost } from './color';

describe('isPublicHost', () => {
	it.each(['127.0.0.1', '10.10.10.23', '100.88.235.74', '172.18.0.5', '192.168.1.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]', '[fd7a:115c:a1e0::1]', 'localhost'])(
		'blocks %s',
		async (host) => expect(await isPublicHost(host)).toBe(false),
	);

	it('allows public addresses', async () => {
		expect(await isPublicHost('1.1.1.1')).toBe(true);
		expect(await isPublicHost('[2606:4700:4700::1111]')).toBe(true);
	});
});
