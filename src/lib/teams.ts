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
