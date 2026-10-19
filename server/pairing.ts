// Device pairing: the car shows a QR code, a phone already signed in to Authentik approves it,
// and the car gets its own long-lived device cookie. Only token hashes are stored.
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export const DEVICE_COOKIE = 'tesla_device';
export const PAIR_COOKIE = 'tesla_pair';
const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 20;
const START_LIMIT_PER_MIN = 10;
// No 0/O/1/I so the code is easy to compare between car and phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Device {
	id: string;
	name: string;
	tokenHash: string;
	approvedBy: string;
	createdAt: string;
	expiresAt: string;
	lastSeenAt: string;
}

interface Pairing {
	code: string;
	pollHash: string;
	expiresAt: number;
	/** Set on approval; handed to the waiting car exactly once. */
	deviceToken?: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');

function sameHash(a: string, b: string): boolean {
	const x = Buffer.from(a, 'hex');
	const y = Buffer.from(b, 'hex');
	return x.length === y.length && timingSafeEqual(x, y);
}

export function newCode(): string {
	const bytes = randomBytes(8);
	const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
	return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function parseCookies(header: string | null): Record<string, string> {
	const cookies: Record<string, string> = {};
	for (const part of (header ?? '').split(';')) {
		const index = part.indexOf('=');
		if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
	}
	return cookies;
}

export function cookie(name: string, value: string, maxAgeMs: number): string {
	return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

export function createPairing(devicesFile: string) {
	const pairings = new Map<string, Pairing>();
	let startTimes: number[] = [];
	let devices: Device[] = existsSync(devicesFile) ? JSON.parse(readFileSync(devicesFile, 'utf-8')) : [];

	function save(): void {
		mkdirSync(dirname(devicesFile), { recursive: true });
		const tmp = `${devicesFile}.tmp`;
		writeFileSync(tmp, JSON.stringify(devices, null, '\t'), { mode: 0o600 });
		renameSync(tmp, devicesFile);
	}

	function prune(now = Date.now()): void {
		for (const [code, p] of pairings) if (p.expiresAt < now) pairings.delete(code);
		const before = devices.length;
		devices = devices.filter((d) => Date.parse(d.expiresAt) > now);
		if (devices.length !== before) save();
	}

	/** Device for a request's cookie header, or null. Updates lastSeenAt at most once a minute. */
	function authenticate(cookieHeader: string | null): Device | null {
		const raw = parseCookies(cookieHeader)[DEVICE_COOKIE];
		if (!raw) return null;
		const hash = sha256(raw);
		const now = Date.now();
		const device = devices.find((d) => sameHash(d.tokenHash, hash) && Date.parse(d.expiresAt) > now);
		if (!device) return null;
		if (now - Date.parse(device.lastSeenAt) > 60_000) {
			device.lastSeenAt = new Date(now).toISOString();
			save();
		}
		return device;
	}

	/** Car side: open a pairing. Returns null when rate-limited. */
	function start(): { code: string; pollToken: string } | null {
		const now = Date.now();
		prune(now);
		startTimes = startTimes.filter((t) => now - t < 60_000);
		if (startTimes.length >= START_LIMIT_PER_MIN || pairings.size >= MAX_PENDING) return null;
		startTimes.push(now);

		let code = newCode();
		while (pairings.has(code)) code = newCode();
		const pollToken = token();
		pairings.set(code, { code, pollHash: sha256(pollToken), expiresAt: now + PAIRING_TTL_MS });
		return { code, pollToken };
	}

	function issueDevice(name: string, approvedBy: string): string {
		const deviceToken = token();
		const now = new Date();
		devices.push({
			id: randomBytes(8).toString('hex'),
			name: name.trim().slice(0, 60) || 'Gerät',
			tokenHash: sha256(deviceToken),
			approvedBy,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + DEVICE_TTL_MS).toISOString(),
			lastSeenAt: now.toISOString(),
		});
		save();
		return deviceToken;
	}

	/** Phone side: approve a code shown in the car. Returns the device token, or null for an unknown/expired code. */
	function approve(code: string, name: string, approvedBy: string): string | null {
		prune();
		const pairing = pairings.get(code.trim().toUpperCase());
		if (!pairing || pairing.deviceToken) return null;
		pairing.deviceToken = issueDevice(name, approvedBy);
		return pairing.deviceToken;
	}

	/** Car side: poll with the cookie from start(). Returns the device token once, after approval. */
	function poll(pollToken: string | undefined): 'pending' | 'expired' | { deviceToken: string } {
		if (!pollToken) return 'expired';
		prune();
		const hash = sha256(pollToken);
		for (const [code, p] of pairings) {
			if (!sameHash(p.pollHash, hash)) continue;
			if (!p.deviceToken) return 'pending';
			pairings.delete(code);
			return { deviceToken: p.deviceToken };
		}
		return 'expired';
	}

	/** Whether this browser started the pairing being approved (then it can be signed in right away). */
	function startedBy(code: string, pollToken: string | undefined): boolean {
		const pairing = pairings.get(code.trim().toUpperCase());
		return !!pairing && !!pollToken && sameHash(pairing.pollHash, sha256(pollToken));
	}

	function list() {
		prune();
		return devices.map(({ tokenHash: _hash, ...rest }) => rest);
	}

	function revoke(id: string): boolean {
		const before = devices.length;
		devices = devices.filter((d) => d.id !== id);
		if (devices.length === before) return false;
		save();
		return true;
	}

	return { authenticate, start, approve, poll, startedBy, issueDevice, list, revoke };
}
