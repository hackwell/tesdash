// Car side of pairing: show a QR code for the phone, poll until it is approved.
import { encode } from 'uqr';

const POLL_MS = 2_000;

export function approveUrl(origin: string, code: string): string {
	return `${origin}/admin/?code=${encodeURIComponent(code)}`;
}

function drawQr(canvas: HTMLCanvasElement, text: string): void {
	const { data, size } = encode(text, { ecc: 'M', border: 2 });
	// Crisp modules on the car's fractional DPR (1.53): size the backing store in device pixels.
	const cssSize = canvas.clientWidth || 232;
	const scale = Math.max(1, Math.floor((cssSize * devicePixelRatio) / size));
	canvas.width = canvas.height = size * scale;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#000';
	data.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(x * scale, y * scale, scale, scale)));
}

export function initPairPage(): void {
	const status = document.getElementById('pair-status')!;
	const codeEl = document.getElementById('pair-code')!;
	const canvas = document.getElementById('pair-qr') as HTMLCanvasElement;
	const alt = document.getElementById('pair-alt') as HTMLAnchorElement;
	let timer: ReturnType<typeof setInterval> | undefined;

	async function start(): Promise<void> {
		clearInterval(timer);
		status.textContent = 'Code wird erstellt …';
		const res = await fetch('/api/pair/start', { method: 'POST' });
		if (!res.ok) {
			status.textContent = 'Gerade zu viele Versuche. Bitte in einer Minute neu laden.';
			return;
		}
		const { code } = (await res.json()) as { code: string };
		const url = approveUrl(location.origin, code);
		codeEl.textContent = code;
		drawQr(canvas, url);
		alt.href = url;
		status.textContent = 'Warte auf Freigabe am Handy …';
		timer = setInterval(poll, POLL_MS);
	}

	async function poll(): Promise<void> {
		try {
			const res = await fetch('/api/pair/status', { cache: 'no-store' });
			const { status: state } = (await res.json()) as { status: string };
			if (state === 'approved') {
				clearInterval(timer);
				status.textContent = 'Freigegeben.';
				location.replace('/');
			} else if (state === 'expired') {
				start(); // codes live five minutes; show a fresh one
			}
		} catch {
			// network blip in the car; keep polling
		}
	}

	start();
}
