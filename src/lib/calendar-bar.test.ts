import { describe, expect, it } from 'bun:test';
import { attendeeLabel, durationLabel, myResponseLabel, relativeLabel, upcoming, type CalendarEvent } from './calendar-bar';

const now = Date.parse('2026-10-20T08:00:00Z'); // 10:00 Berlin
const ev = (start: string, end: string): CalendarEvent => ({
	subject: 'X', start, end, location: '', joinUrl: null, tentative: false, source: 'flagbit',
});

describe('relativeLabel', () => {
	it('describes running and upcoming meetings', () => {
		expect(relativeLabel(ev('2026-10-20T07:30:00Z', '2026-10-20T08:30:00Z'), now)).toBe('läuft · bis 10:30');
		expect(relativeLabel(ev('2026-10-20T08:12:00Z', '2026-10-20T08:30:00Z'), now)).toBe('in 12 min');
		expect(relativeLabel(ev('2026-10-20T10:05:00Z', '2026-10-20T11:00:00Z'), now)).toBe('in 2 h 5 min');
		expect(relativeLabel(ev('2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z'), now)).toBe('15:00–16:00');
	});
});

describe('upcoming', () => {
	it('drops finished meetings and sorts by start', () => {
		const done = ev('2026-10-20T06:00:00Z', '2026-10-20T07:00:00Z');
		const later = ev('2026-10-20T12:00:00Z', '2026-10-20T13:00:00Z');
		const running = ev('2026-10-20T07:45:00Z', '2026-10-20T08:15:00Z');
		expect(upcoming([later, done, running], now)).toEqual([running, later]);
	});
});

describe('meeting details', () => {
	const base = ev('2026-10-20T07:00:00Z', '2026-10-20T08:30:00Z');

	it('formats duration and attendees', () => {
		expect(durationLabel(base)).toBe('1 h 30 min');
		expect(durationLabel(ev('2026-10-20T07:00:00Z', '2026-10-20T07:25:00Z'))).toBe('25 min');
		expect(attendeeLabel({ ...base, attendees: { total: 6, accepted: 4, tentative: 1, declined: 0 } })).toBe('6 Teilnehmer · 4 zugesagt · 1 unsicher');
		expect(attendeeLabel({ ...base, attendees: { total: 0, accepted: 0, tentative: 0, declined: 0 } })).toBeNull();
	});

	it('flags my own missing answer, not when I organise', () => {
		expect(myResponseLabel({ ...base, myResponse: 'notResponded' })).toBe('nicht beantwortet');
		expect(myResponseLabel({ ...base, myResponse: 'notResponded', isOrganizer: true })).toBeNull();
		expect(myResponseLabel({ ...base, myResponse: 'accepted' })).toBeNull();
	});
});
