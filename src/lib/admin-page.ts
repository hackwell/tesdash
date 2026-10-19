// Phone/desktop side (behind Authentik): approve a car's code, list and revoke paired devices.
import { toast } from './toast';

interface DeviceInfo {
	id: string;
	name: string;
	approvedBy: string;
	createdAt: string;
	expiresAt: string;
	lastSeenAt: string;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });

async function postJson(url: string, body: unknown, method = 'POST'): Promise<Response> {
	return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function initAdminPage(): void {
	const list = document.getElementById('device-list')!;
	const status = document.getElementById('admin-status')!;
	const code = new URLSearchParams(location.search).get('code');

	async function loadDevices(): Promise<void> {
		const res = await fetch('/api/admin/devices', { cache: 'no-store' });
		if (!res.ok) {
			status.hidden = false;
			status.textContent = 'Kein Zugriff: dieses Konto darf keine Geräte freigeben.';
			return;
		}
		const { devices } = (await res.json()) as { devices: DeviceInfo[] };
		list.replaceChildren(
			...devices.map((device) => {
				const row = document.createElement('li');
				const info = document.createElement('div');
				const name = document.createElement('strong');
				name.textContent = device.name;
				const meta = document.createElement('span');
				meta.className = 'device-meta';
				meta.textContent = `zuletzt ${dateFormat.format(new Date(device.lastSeenAt))} · gültig bis ${dateFormat.format(new Date(device.expiresAt))}`;
				info.append(name, meta);
				const revoke = document.createElement('button');
				revoke.type = 'button';
				revoke.className = 'cat-btn cat-btn--danger';
				revoke.textContent = 'Entfernen';
				revoke.addEventListener('click', async () => {
					const res = await fetch(`/api/admin/devices/${device.id}`, { method: 'DELETE' });
					toast(res.ok ? `${device.name} entfernt.` : 'Entfernen fehlgeschlagen.');
					loadDevices();
				});
				row.append(info, revoke);
				return row;
			}),
		);
		if (!devices.length) list.append(Object.assign(document.createElement('li'), { textContent: 'Noch keine Geräte.' }));
	}

	if (code) {
		document.getElementById('approve')!.hidden = false;
		document.getElementById('approve-code')!.textContent = code;
		document.getElementById('approve-btn')!.addEventListener('click', async () => {
			const name = (document.getElementById('approve-name') as HTMLInputElement).value;
			const res = await postJson('/api/admin/approve', { code, name });
			if (!res.ok) {
				toast(res.status === 404 ? 'Code abgelaufen. Im Auto neu laden.' : 'Freigabe fehlgeschlagen.');
				return;
			}
			const { signedIn } = (await res.json()) as { signedIn?: boolean };
			if (signedIn) {
				location.replace('/');
				return;
			}
			document.getElementById('approve')!.hidden = true;
			status.hidden = false;
			status.textContent = 'Freigegeben. Das Auto meldet sich in wenigen Sekunden an.';
			history.replaceState(null, '', '/admin/');
			loadDevices();
		});
	}

	document.getElementById('pair-self')!.addEventListener('click', async () => {
		const res = await postJson('/api/admin/pair-self', { name: navigator.platform ? `Browser (${navigator.platform})` : 'Browser' });
		if (res.ok) location.replace('/');
		else toast('Koppeln fehlgeschlagen.');
	});

	loadDevices();
}
