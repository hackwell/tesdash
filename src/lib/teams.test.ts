import { describe, expect, it } from 'bun:test';
import { safeMeetingUrl, webJoinUrl } from './teams';

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

describe('safeMeetingUrl', () => {
	it.each([
		['https://teams.microsoft.com/l/meetup-join/19%3a/0', true],
		['https://flagbit.zoom.us/j/123', true],
		['https://meet.google.com/abc-defg-hij', true],
		['https://evil.example/teams.microsoft.com/l/meetup-join/x', false],
		['https://teams.microsoft.com.evil.example/l/meetup-join/x', false],
		['https://user@teams.microsoft.com/l/meetup-join/x', false],
		['http://teams.microsoft.com/l/meetup-join/x', false],
		['javascript:alert(1)', false],
	])('%s -> %p', (raw, ok) => {
		expect(safeMeetingUrl(raw) !== null).toBe(ok);
	});
});
