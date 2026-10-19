import { describe, expect, it } from 'bun:test';
import { canonicalPath } from './paths';

describe('canonicalPath', () => {
	it('decodes ordinary paths', () => {
		expect(canonicalPath('/pair/')).toBe('/pair/');
		expect(canonicalPath('/logos/n%C3%A4me.svg')).toBe('/logos/näme.svg');
	});

	it.each(['/pair/..%2Fapi%2Fstate', '/pair/%2e%2e/api/state', '/pair/%2E%2E/admin/', '/a%5Cb', '/a%00', '/%E0%A4%A', '/pair/./x'])('rejects %s', (raw) => {
		expect(canonicalPath(raw)).toBeNull();
	});
});
