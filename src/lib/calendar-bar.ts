// Today's meetings (Flagbit + Runprise via Wellbot's export) with one-tap web join.
import { mdiCalendarAlert, mdiMicrosoftTeams, mdiVideo } from '@mdi/js';
import { iconSvg } from './icons';
import { webJoinUrl } from './teams';

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

/** Events not yet over, in start order. */
export function upcoming(events: CalendarEvent[], now: number): CalendarEvent[] {
	return events.filter((e) => Date.parse(e.end) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function joinLink(event: CalendarEvent, big: boolean): HTMLAnchorElement | null {
	if (!event.joinUrl) return null;
	const isTeams = /teams\.(microsoft|live)\.com/.test(event.joinUrl);
	const link = document.createElement('a');
	link.className = big ? 'cal-join' : 'cal-join cal-join--small';
	// The car browser opens every link in its single tab, which is what we want here.
	link.href = isTeams ? webJoinUrl(event.joinUrl) : event.joinUrl;
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
			meta.append(sourceBadge(next), `${hhmm(next.start)}–${hhmm(next.end)}${next.tentative ? ' · unsicher' : ''}`);
			info.append(when, subject, meta);
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
