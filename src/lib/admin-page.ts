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
	const ref = new URLSearchParams(location.search).get('ref');

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

	async function showPairing(pairingRef: string): Promise<void> {
		const res = await fetch(`/api/admin/pairing?ref=${encodeURIComponent(pairingRef)}`, { cache: 'no-store' });
		if (!res.ok) {
			status.hidden = false;
			status.textContent = 'Diese Kopplung ist abgelaufen oder schon erledigt. Im Auto neu laden.';
			return;
		}
		const info = (await res.json()) as { ageSeconds: number; userAgent: string };
		document.getElementById('approve')!.hidden = false;
		document.getElementById('approve-info')!.textContent =
			`Angefragt vor ${Math.max(1, Math.round(info.ageSeconds / 60))} min · ${info.userAgent.includes('Tesla') ? 'Tesla-Browser' : info.userAgent.slice(0, 80)}`;
		const codeInput = document.getElementById('approve-code') as HTMLInputElement;
		codeInput.focus();

		document.getElementById('approve-btn')!.addEventListener('click', async () => {
			const name = (document.getElementById('approve-name') as HTMLInputElement).value;
			const res = await postJson('/api/admin/approve', { ref: pairingRef, code: codeInput.value, name });
			if (res.status === 400) {
				toast('Code stimmt nicht. Bitte den Code vom Bildschirm im Auto eintippen.');
				return;
			}
			if (!res.ok) {
				toast('Kopplung abgelaufen. Im Auto neu laden.');
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

	if (ref) showPairing(ref);

	document.getElementById('pair-self')!.addEventListener('click', async () => {
		const res = await postJson('/api/admin/pair-self', { name: navigator.platform ? `Browser (${navigator.platform})` : 'Browser' });
		if (res.ok) location.replace('/');
		else toast('Koppeln fehlgeschlagen.');
	});

	loadDevices();
}
