// House controls and car status from Home Assistant, rendered above the app grid.
import { statusIcon, tileIcon } from './icons';
import { toast } from './toast';

const POLL_MS = 15_000;
const HOLD_MS = 900;

interface HomeTile {
	id: string;
	name: string;
	domain: string;
	state: string;
	hold: boolean;
	icon: string;
}

interface HomeSnapshot {
	enabled: boolean;
	reachable?: boolean;
	status?: { label: string; icon: string; value: string | null; unit: string }[];
	tiles?: HomeTile[];
}

const STATE_LABELS: Record<string, string> = {
	open: 'Offen',
	closed: 'Geschlossen',
	opening: 'Öffnet …',
	closing: 'Schließt …',
	on: 'An',
	off: 'Aus',
	unavailable: 'Nicht erreichbar',
};

/** Closed covers open; open or moving covers close. */
function coverAction(state: string): 'open' | 'close' {
	return state === 'closed' ? 'open' : 'close';
}

function actionFor(tile: HomeTile): 'open' | 'close' | 'toggle' {
	return tile.domain === 'cover' ? coverAction(tile.state) : 'toggle';
}

function hintFor(tile: HomeTile): string {
	if (tile.domain !== 'cover' || tile.state === 'unavailable' || !tile.hold) return '';
	return coverAction(tile.state) === 'open' ? 'Halten zum Öffnen' : 'Halten zum Schließen';
}

export function initHomeBar(): void {
	const root = document.getElementById('home')!;
	const statusRow = document.getElementById('home-status')!;
	const tilesRow = document.getElementById('home-tiles')!;
	let tiles: HomeTile[] = [];
	let busy = false;

	async function refresh(): Promise<void> {
		let snap: HomeSnapshot;
		try {
			const res = await fetch('/api/home', { cache: 'no-store' });
			snap = await res.json();
		} catch {
			return;
		}
		root.hidden = !snap.enabled;
		if (!snap.enabled) return;

		const items = (snap.status ?? []).filter((s) => s.value !== null).map((s) => {
			const item = document.createElement('span');
			const icon = statusIcon(s.icon, s.value);
			if (icon) item.append(icon);
			item.append(s.label);
			const value = document.createElement('b');
			value.textContent = `${s.value}${s.unit ? ` ${s.unit}` : ''}`;
			item.append(value);
			return item;
		});
		if (snap.reachable === false) {
			const offline = document.createElement('span');
			offline.className = 'home-offline';
			offline.textContent = 'Home Assistant nicht erreichbar';
			items.unshift(offline);
		}
		statusRow.replaceChildren(...items);

		tiles = snap.tiles ?? [];
		if (!busy) render();
	}

	function render(): void {
		tilesRow.replaceChildren(
			...tiles.map((tile) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = `home-tile${tile.domain === 'cover' ? ' home-tile--wide' : ''}`;
				button.dataset.id = tile.id;
				button.dataset.state = tile.state;
				button.disabled = tile.state === 'unavailable';
				button.style.setProperty('--hold-ms', `${HOLD_MS}ms`);

				const progress = document.createElement('span');
				progress.className = 'home-tile-progress';
				const name = document.createElement('span');
				name.className = 'home-tile-name';
				name.textContent = tile.name;
				const state = document.createElement('span');
				state.className = 'home-tile-state';
				state.textContent = STATE_LABELS[tile.state] ?? tile.state;
				const hint = document.createElement('span');
				hint.className = 'home-tile-hint';
				hint.textContent = hintFor(tile);

				const head = document.createElement('span');
				head.className = 'home-tile-head';
				const icon = tileIcon(tile.icon, tile.state);
				if (icon) head.append(icon);
				head.append(name);
				button.append(progress, head, state, hint);
				return button;
			}),
		);
	}

	async function trigger(tile: HomeTile): Promise<void> {
		busy = true;
		try {
			const action = actionFor(tile);
			const res = await fetch(`/api/home/tiles/${tile.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			});
			if (res.status === 403) toast(`${tile.name}: geht nur, wenn das Auto zu Hause ist.`);
			else if (!res.ok) toast(`${tile.name}: hat nicht geklappt.`);
			else if (tile.domain === 'cover') toast(`${tile.name}: ${action === 'open' ? 'öffnet' : 'schließt'}.`);
		} catch {
			toast(`${tile.name}: Server nicht erreichbar.`);
		} finally {
			busy = false;
			await refresh();
			setTimeout(refresh, 3_000);
		}
	}

	// Hold-to-activate: the action fires only after the pointer stayed down for HOLD_MS.
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let holding: HTMLElement | null = null;

	function cancelHold(): void {
		clearTimeout(holdTimer);
		holding?.classList.remove('is-holding');
		holding = null;
	}

	tilesRow.addEventListener('pointerdown', (e) => {
		const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.home-tile');
		const tile = tiles.find((t) => t.id === button?.dataset.id);
		if (!button || !tile || button.disabled || busy) return;
		if (!tile.hold) return;
		cancelHold();
		holding = button;
		button.classList.add('is-holding');
		holdTimer = setTimeout(() => {
			cancelHold();
			trigger(tile);
		}, HOLD_MS);
	});
	for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
		tilesRow.addEventListener(type, cancelHold);
	}
	tilesRow.addEventListener('contextmenu', (e) => e.preventDefault());

	tilesRow.addEventListener('click', (e) => {
		const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.home-tile');
		const tile = tiles.find((t) => t.id === button?.dataset.id);
		if (!tile || tile.hold || busy) return;
		trigger(tile);
	});

	refresh();
	setInterval(() => {
		if (document.visibilityState === 'visible') refresh();
	}, POLL_MS);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') refresh();
	});
}
