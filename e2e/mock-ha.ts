// Fake Home Assistant for tests and emulator checks. Never point the dashboard at the real HA while testing actions.
const PORT = Number(process.env.MOCK_HA_PORT ?? 4174);
export const HOME = { latitude: 50.1, longitude: 8.6 };

const states = new Map<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>(
	[
		['cover.garagentor', 'closed', {}],
		['light.0x00178801067e284f', 'off', {}],
		['light.0x00178801067e2dd1', 'off', {}],
		['light.aussenbeleuchtung', 'off', {}],
		['sun.sun', 'below_horizon', {}],
		['device_tracker.tesla_model_y_location_tracker_2', 'home', { latitude: 50.1005, longitude: 8.6005 }],
	].map(([id, state, attributes]) => [id as string, { entity_id: id as string, state: state as string, attributes: attributes as Record<string, unknown> }]),
);
const calls: { service: string; entity_id: string }[] = [];

Bun.serve({
	port: PORT,
	async fetch(req) {
		const { pathname } = new URL(req.url);
		if (pathname === '/__calls') return Response.json(calls);
		if (pathname === '/__reset') {
			calls.length = 0;
			states.get('cover.garagentor')!.state = 'closed';
			states.get('sun.sun')!.state = 'below_horizon';
			states.get('device_tracker.tesla_model_y_location_tracker_2')!.attributes = { latitude: 50.1005, longitude: 8.6005 };
			return Response.json({ ok: true });
		}
		if (pathname === '/__sun') {
			states.get('sun.sun')!.state = new URL(req.url).searchParams.get('state') ?? 'below_horizon';
			return Response.json({ ok: true });
		}
		if (pathname === '/__car') {
			// Move the car: ?lat=..&lon=.. or no params for "no position".
			const q = new URL(req.url).searchParams;
			states.get('device_tracker.tesla_model_y_location_tracker_2')!.attributes = q.has('lat')
				? { latitude: Number(q.get('lat')), longitude: Number(q.get('lon')) }
				: {};
			return Response.json({ ok: true });
		}
		if (req.headers.get('authorization') !== 'Bearer test-token') return new Response('unauthorized', { status: 401 });
		if (pathname === '/api/config') return Response.json(HOME);
		if (pathname === '/api/states') return Response.json([...states.values()]);
		const single = pathname.match(/^\/api\/states\/(.+)$/);
		if (single) return states.has(single[1]) ? Response.json(states.get(single[1])) : new Response('not found', { status: 404 });
		const service = pathname.match(/^\/api\/services\/(\w+)\/(\w+)$/);
		if (service && req.method === 'POST') {
			const { entity_id } = await req.json();
			calls.push({ service: `${service[1]}.${service[2]}`, entity_id });
			const entity = states.get(entity_id);
			if (entity && service[2] === 'open_cover') entity.state = 'open';
			if (entity && service[2] === 'close_cover') entity.state = 'closed';
			if (entity && service[2] === 'toggle') entity.state = entity.state === 'on' ? 'off' : 'on';
			return Response.json([]);
		}
		return new Response('not found', { status: 404 });
	},
});
console.log(`[mock-ha] listening on :${PORT}`);
