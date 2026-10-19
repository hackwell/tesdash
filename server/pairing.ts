// Device pairing: the car shows a QR code, a phone already signed in to Authentik approves it,
// and the car gets its own long-lived device cookie. Only token hashes are stored.
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export const DEVICE_COOKIE = 'tesla_device';
export const PAIR_COOKIE = 'tesla_pair';
const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 100;
const START_LIMIT_PER_MIN = 5; // per client IP
const MAX_CODE_ATTEMPTS = 5;
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
	/** In the QR code. Identifies the pairing but does not approve it. */
	ref: string;
	/** Shown only on the car's screen; the approver types it on the phone. */
	code: string;
	pollHash: string;
	createdAt: number;
	expiresAt: number;
	attempts: number;
	userAgent: string;
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
	return [...randomBytes(4)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function parseCookies(header: string | null): Record<string, string> {
	const cookies: Record<string, string> = {};
	for (const part of (header ?? '').split(';')) {
		const index = part.indexOf('=');
		if (index <= 0) continue;
		try {
			cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
		} catch {
			// malformed value: ignore this cookie
		}
	}
	return cookies;
}

export function cookie(name: string, value: string, maxAgeMs: number): string {
	return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

export function createPairing(devicesFile: string) {
	const pairings = new Map<string, Pairing>();
	const startTimes = new Map<string, number[]>();
	let devices: Device[] = existsSync(devicesFile) ? JSON.parse(readFileSync(devicesFile, 'utf-8')) : [];

	function save(): void {
		mkdirSync(dirname(devicesFile), { recursive: true });
		const tmp = `${devicesFile}.tmp`;
		writeFileSync(tmp, JSON.stringify(devices, null, '\t'), { mode: 0o600 });
		renameSync(tmp, devicesFile);
	}

	function prune(now = Date.now()): void {
		for (const [ref, p] of pairings) if (p.expiresAt < now) pairings.delete(ref);
		for (const [ip, times] of startTimes) if (!times.some((t) => now - t < 60_000)) startTimes.delete(ip);
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

	/** Car side: open a pairing. Returns null when this client is rate-limited. */
	function start(clientIp: string, userAgent: string): { ref: string; code: string; pollToken: string } | null {
		const now = Date.now();
		prune(now);
		const recent = (startTimes.get(clientIp) ?? []).filter((t) => now - t < 60_000);
		if (recent.length >= START_LIMIT_PER_MIN) return null;
		startTimes.set(clientIp, [...recent, now]);
		// A flood (e.g. with forged client IPs) evicts the oldest pending pairing instead of locking everyone out.
		if (pairings.size >= MAX_PENDING) pairings.delete(pairings.keys().next().value!);

		const ref = randomBytes(16).toString('hex');
		const pollToken = token();
		pairings.set(ref, {
			ref,
			code: newCode(),
			pollHash: sha256(pollToken),
			createdAt: now,
			expiresAt: now + PAIRING_TTL_MS,
			attempts: 0,
			userAgent: userAgent.slice(0, 200),
		});
		return { ref, code: pairings.get(ref)!.code, pollToken };
	}

	/** What the approve page may show about a pending pairing (never the code itself). */
	function describe(ref: string): { ageSeconds: number; userAgent: string } | null {
		prune();
		const p = pairings.get(ref);
		if (!p || p.deviceToken) return null;
		return { ageSeconds: Math.round((Date.now() - p.createdAt) / 1000), userAgent: p.userAgent };
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

	/**
	 * Phone side: approve the pairing from the QR code with the code typed from the car's screen.
	 * Returns the device token, 'wrong-code', or null for an unknown/expired/used pairing.
	 */
	function approve(ref: string, typedCode: string, name: string, approvedBy: string, holdsPollToken = false): string | 'wrong-code' | null {
		prune();
		const pairing = pairings.get(ref);
		if (!pairing || pairing.deviceToken) return null;
		// The browser that started the pairing has already proven it is the screen showing the code.
		if (holdsPollToken) {
			pairing.deviceToken = issueDevice(name, approvedBy);
			return pairing.deviceToken;
		}
		const typed = typedCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
		if (!timingSafeEqual(Buffer.from(sha256(typed), 'hex'), Buffer.from(sha256(pairing.code), 'hex'))) {
			pairing.attempts += 1;
			if (pairing.attempts >= MAX_CODE_ATTEMPTS) pairings.delete(ref); // no guessing
			return 'wrong-code';
		}
		pairing.deviceToken = issueDevice(name, approvedBy);
		return pairing.deviceToken;
	}

	/** Car side: poll with the cookie from start(). Returns the device token once, after approval. */
	function poll(pollToken: string | undefined): 'pending' | 'expired' | { deviceToken: string } {
		if (!pollToken) return 'expired';
		prune();
		const hash = sha256(pollToken);
		for (const [ref, p] of pairings) {
			if (!sameHash(p.pollHash, hash)) continue;
			if (!p.deviceToken) return 'pending';
			pairings.delete(ref);
			return { deviceToken: p.deviceToken };
		}
		return 'expired';
	}

	/** Whether this browser started the pairing being approved (then it can be signed in right away). */
	function startedBy(ref: string, pollToken: string | undefined): boolean {
		const pairing = pairings.get(ref);
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

	return { authenticate, start, describe, approve, poll, startedBy, issueDevice, list, revoke };
}
