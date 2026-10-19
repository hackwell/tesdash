import { describe, expect, it } from 'bun:test';
import { webJoinUrl } from './teams';

describe('webJoinUrl', () => {
	it('turns a meetup-join link into a direct web-join launcher URL', () => {
		const join = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d';
		const url = new URL(webJoinUrl(join));
		expect(url.origin + url.pathname).toBe('https://teams.microsoft.com/dl/launcher/launcher.html');
		expect(url.searchParams.get('url')).toBe('/_#/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d');
		expect(url.searchParams.get('msLaunch')).toBe('false');
		expect(url.searchParams.get('suppressPrompt')).toBe('true');
		expect(url.searchParams.get('type')).toBe('meetup-join');
	});

	it('leaves other meeting links alone', () => {
		expect(webJoinUrl('https://zoom.us/j/123')).toBe('https://zoom.us/j/123');
		expect(webJoinUrl('https://teams.microsoft.com/meet/123?p=abc')).toBe('https://teams.microsoft.com/meet/123?p=abc');
		expect(webJoinUrl('not a url')).toBe('not a url');
	});
});
