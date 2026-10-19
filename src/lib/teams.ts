const MEETING_HOSTS: [string, string][] = [
	['teams.microsoft.com', '/l/meetup-join/'],
	['teams.microsoft.com', '/meet/'],
	['teams.live.com', '/meet/'],
	['meet.google.com', '/'],
	['zoom.us', '/j/'],
];

/** The link if it is https to a known meeting service (exact host or subdomain), else null. */
export function safeMeetingUrl(raw: string | null): URL | null {
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return null;
	const host = url.hostname.toLowerCase();
	const ok = MEETING_HOSTS.some(([allowed, prefix]) => (host === allowed || host.endsWith(`.${allowed}`)) && url.pathname.startsWith(prefix));
	return ok ? url : null;
}

export function isTeamsUrl(url: URL): boolean {
	return url.hostname === 'teams.microsoft.com' || url.hostname === 'teams.live.com';
}

// Teams meeting links open a launcher that asks to start the desktop app. In the car there is no app,
// so build the launcher URL ourselves with the flags that go straight to joining on the web.
export function webJoinUrl(joinUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(joinUrl);
	} catch {
		return joinUrl;
	}
	if (parsed.hostname !== 'teams.microsoft.com' || !parsed.pathname.startsWith('/l/meetup-join/')) return joinUrl;

	const launcher = new URL('https://teams.microsoft.com/dl/launcher/launcher.html');
	launcher.searchParams.set('url', `/_#${parsed.pathname}${parsed.search}`);
	launcher.searchParams.set('type', 'meetup-join');
	launcher.searchParams.set('directDl', 'true');
	launcher.searchParams.set('msLaunch', 'false');
	launcher.searchParams.set('enableMobilePage', 'true');
	launcher.searchParams.set('suppressPrompt', 'true');
	return launcher.href;
}
