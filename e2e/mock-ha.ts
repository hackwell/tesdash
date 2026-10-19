// Fake Home Assistant for tests and emulator checks. Never point the dashboard at the real HA while testing actions.
const PORT = Number(process.env.MOCK_HA_PORT ?? 4174);
export const HOME = { latitude: 50.1, longitude: 8.6 };

const states = new Map<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>(
	[
		['sensor.tesla_model_y_battery_2', '36', {}],
		['sensor.tesla_model_y_range_2', '200.91', {}],
		['sensor.tesla_model_y_charger_power_2', '0.0', {}],
		['weather.pirateweather', 'cloudy', { temperature: 11.4 }],
		['cover.garagentor', 'closed', {}],
		['light.0x00178801067e284f', 'off', {}],
		['light.0x00178801067e2dd1', 'off', {}],
		['light.aussenbeleuchtung', 'off', {}],
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
			return Response.json({ ok: true });
		}
		if (req.headers.get('authorization') !== 'Bearer test-token') return new Response('unauthorized', { status: 401 });
		if (pathname === '/api/config') return Response.json(HOME);
		if (pathname === '/api/states') return Response.json([...states.values()]);
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
