// Today's meetings (Flagbit + Runprise via Wellbot's export) with one-tap web join.
import {
	mdiAccountMultipleOutline,
	mdiAccountStarOutline,
	mdiAccountTieOutline,
	mdiCalendarAlert,
	mdiClockOutline,
	mdiHelpCircleOutline,
	mdiMapMarkerOutline,
	mdiMicrosoftTeams,
	mdiVideo,
} from '@mdi/js';
import { iconSvg } from './icons';
import { isTeamsUrl, safeMeetingUrl, webJoinUrl } from './teams';

const POLL_MS = 60_000;
const TICK_MS = 30_000;
const SOURCE_LABELS: Record<string, string> = { flagbit: 'Flagbit', runprise: 'Runprise' };

export interface CalendarEvent {
	subject: string;
	start: string;
	end: string;
	location: string;
	joinUrl: string | null;
	tentative: boolean;
	source: string;
	organizer?: string;
	isOrganizer?: boolean;
	myResponse?: string;
	attendees?: { total: number; accepted: number; tentative: number; declined: number };
}

interface CalendarSnapshot {
	enabled: boolean;
	generatedAt?: string;
	stale?: boolean;
	errors?: string[];
	events?: CalendarEvent[];
}

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

export function hhmm(iso: string): string {
	return timeFormat.format(new Date(iso));
}

/** "läuft · bis 10:30", "in 12 min", "in 2 h 5 min" or the start time for later today. */
export function relativeLabel(event: CalendarEvent, now: number): string {
	const start = Date.parse(event.start);
	if (start <= now) return `läuft · bis ${hhmm(event.end)}`;
	const minutes = Math.round((start - now) / 60_000);
	if (minutes < 1) return 'beginnt jetzt';
	if (minutes < 60) return `in ${minutes} min`;
	if (minutes < 180) return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
	return `${hhmm(event.start)}–${hhmm(event.end)}`;
}

export function durationLabel(event: CalendarEvent): string {
	const minutes = Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000);
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

/** "6 Teilnehmer · 4 zugesagt" (others = invitees besides me). */
export function attendeeLabel(event: CalendarEvent): string | null {
	const a = event.attendees;
	if (!a || a.total === 0) return null;
	const parts = [`${a.total} Teilnehmer`];
	if (a.accepted) parts.push(`${a.accepted} zugesagt`);
	if (a.tentative) parts.push(`${a.tentative} unsicher`);
	if (a.declined) parts.push(`${a.declined} abgesagt`);
	return parts.join(' · ');
}

/** My own answer when it needs attention; organiser and accepted need no badge. */
export function myResponseLabel(event: CalendarEvent): string | null {
	if (event.isOrganizer) return null;
	if (event.myResponse === 'notResponded' || event.myResponse === 'none') return 'nicht beantwortet';
	if (event.myResponse === 'tentativelyAccepted' || event.tentative) return 'du: unsicher';
	return null;
}

function detail(icon: string, text: string, className = 'cal-detail'): HTMLElement {
	const span = document.createElement('span');
	span.className = className;
	span.append(iconSvg(icon, 'cal-detail-icon'), text);
	return span;
}

/** Events not yet over, in start order. */
export function upcoming(events: CalendarEvent[], now: number): CalendarEvent[] {
	return events.filter((e) => Date.parse(e.end) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function joinLink(event: CalendarEvent, big: boolean): HTMLAnchorElement | null {
	const url = safeMeetingUrl(event.joinUrl);
	if (!url) return null;
	const isTeams = isTeamsUrl(url);
	const link = document.createElement('a');
	link.className = big ? 'cal-join' : 'cal-join cal-join--small';
	// The car browser opens every link in its single tab, which is what we want here.
	link.href = isTeams ? webJoinUrl(url.href) : url.href;
	link.rel = 'noopener noreferrer';
	link.append(iconSvg(isTeams ? mdiMicrosoftTeams : mdiVideo, 'cal-join-icon'));
	if (big) link.append('Beitreten');
	else link.setAttribute('aria-label', `${event.subject} beitreten`);
	return link;
}

function sourceBadge(event: CalendarEvent): HTMLElement {
	const badge = document.createElement('span');
	badge.className = `cal-source cal-source--${event.source}`;
	badge.textContent = SOURCE_LABELS[event.source] ?? event.source;
	return badge;
}

export function initCalendarBar(): void {
	const root = document.getElementById('calendar')!;
	let snap: CalendarSnapshot = { enabled: false };

	function render(): void {
		const now = Date.now();
		const events = upcoming(snap.events ?? [], now);
		const notices: string[] = [];
		for (const source of snap.errors ?? []) notices.push(`${SOURCE_LABELS[source] ?? 'Kalender'} nicht abrufbar`);
		if (snap.stale && snap.generatedAt) notices.push(`Stand ${hhmm(snap.generatedAt)}`);

		root.hidden = !snap.enabled || (events.length === 0 && notices.length === 0);
		if (root.hidden) return;

		const children: HTMLElement[] = [];
		const [next, ...rest] = events;
		if (next) {
			const card = document.createElement('div');
			card.className = `cal-next${Date.parse(next.start) <= now ? ' is-running' : ''}`;
			const info = document.createElement('div');
			info.className = 'cal-next-info';
			const when = document.createElement('span');
			when.className = 'cal-when';
			when.textContent = relativeLabel(next, now);
			const subject = document.createElement('span');
			subject.className = 'cal-subject';
			subject.textContent = next.subject;
			const meta = document.createElement('span');
			meta.className = 'cal-meta';
			meta.append(sourceBadge(next), `${hhmm(next.start)}–${hhmm(next.end)}`);
			const details = document.createElement('span');
			details.className = 'cal-details';
			details.append(detail(mdiClockOutline, durationLabel(next)));
			if (next.isOrganizer) details.append(detail(mdiAccountStarOutline, 'du organisierst'));
			else if (next.organizer) details.append(detail(mdiAccountTieOutline, next.organizer));
			const people = attendeeLabel(next);
			if (people) details.append(detail(mdiAccountMultipleOutline, people));
			if (next.location && !next.location.includes('://') && !/teams/i.test(next.location)) {
				details.append(detail(mdiMapMarkerOutline, next.location));
			}
			const mine = myResponseLabel(next);
			if (mine) details.append(detail(mdiHelpCircleOutline, mine, 'cal-detail cal-detail--attention'));
			info.append(when, subject, meta, details);
			card.append(info);
			const join = joinLink(next, true);
			if (join) card.append(join);
			children.push(card);
		}

		if (rest.length) {
			const list = document.createElement('ul');
			list.className = 'cal-list';
			for (const event of rest) {
				const row = document.createElement('li');
				const time = document.createElement('span');
				time.className = 'cal-time';
				time.textContent = hhmm(event.start);
				const subject = document.createElement('span');
				subject.className = 'cal-subject-small';
				subject.textContent = event.subject;
				row.append(time, sourceBadge(event), subject);
				const count = event.attendees?.total;
				if (count && count > 1) row.append(detail(mdiAccountMultipleOutline, String(count), 'cal-detail cal-detail--compact'));
				if (myResponseLabel(event) === 'nicht beantwortet') {
					row.append(detail(mdiHelpCircleOutline, '', 'cal-detail cal-detail--attention cal-detail--compact'));
				}
				const join = joinLink(event, false);
				if (join) row.append(join);
				list.append(row);
			}
			children.push(list);
		}

		if (notices.length) {
			const notice = document.createElement('p');
			notice.className = 'cal-notice';
			notice.append(iconSvg(mdiCalendarAlert, 'cal-notice-icon'), notices.join(' · '));
			children.push(notice);
		}
		root.replaceChildren(...children);
	}

	async function refresh(): Promise<void> {
		try {
			const res = await fetch('/api/calendar', { cache: 'no-store' });
			if (res.ok) snap = await res.json();
		} catch {
			// keep the last snapshot; render() still drops meetings that are over
		}
		render();
	}

	refresh();
	setInterval(() => {
		if (document.visibilityState === 'visible') refresh();
	}, POLL_MS);
	setInterval(render, TICK_MS);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') refresh();
	});
}
