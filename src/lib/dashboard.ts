// Client side of the dashboard: renders the shared server state and writes every change back.
import { launchHref, normalizeUrl, type App, type Category, type DashboardState } from './state';

interface StoredState extends DashboardState {
	revision: number;
}

const DRAG_START_PX = 8;
const LONG_PRESS_MS = 350;
const NEW_CATEGORY = '__new__';

const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const handleIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';

function $<T extends HTMLElement>(id: string): T {
	return document.getElementById(id) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

export function initDashboard(): void {
	let state: StoredState = { revision: 0, categories: [] };
	let editing = false;
	let saving: Promise<void> = Promise.resolve();

	const container = $<HTMLElement>('categories');

	// ── Server sync ──

	async function fetchState(): Promise<void> {
		const res = await fetch('/api/state', { cache: 'no-store' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		state = await res.json();
		render();
	}

	/** Applies a change locally, then persists it; on conflict the newer server state wins. */
	function commit(mutate: (draft: DashboardState) => void): Promise<void> {
		saving = saving.then(async () => {
			const draft: StoredState = structuredClone(state);
			mutate(draft);
			state = draft;
			render();
			try {
				const res = await fetch('/api/state', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(draft),
				});
				const body = await res.json();
				if (res.status === 409) {
					state = body.state;
					toast('Wurde zwischendurch woanders geändert. Neu geladen, bitte noch einmal.');
				} else if (!res.ok) {
					throw new Error(body.error ?? `HTTP ${res.status}`);
				} else {
					state = body;
				}
			} catch (err) {
				console.error('[tesla] save failed', err);
				toast('Speichern fehlgeschlagen.');
				await fetchState().catch(() => undefined);
			}
			render();
		});
		return saving;
	}

	// ── Rendering ──

	function renderCard(app: App): HTMLElement {
		const card = el('a', 'card');
		card.href = launchHref(app);
		card.target = '_blank';
		card.rel = 'noopener noreferrer';
		card.dataset.id = app.id;
		card.style.setProperty('--app-color', app.color);

		const del = el('button', 'card-delete');
		del.type = 'button';
		del.setAttribute('aria-label', `${app.name} löschen`);
		del.innerHTML = deleteIcon;
		del.dataset.action = 'delete-app';

		const inner = el('div', 'card-inner');
		const iconWrap = el('div', 'icon-wrap');
		const fallback = el('span', 'icon-fallback', app.name[0]?.toUpperCase() ?? '?');
		fallback.style.color = app.color;
		if (app.logo) {
			const img = el('img');
			img.src = app.logo;
			img.alt = '';
			img.width = 80;
			img.height = 80;
			img.draggable = false;
			const transforms = [app.invert ? 'filter: invert(1)' : '', app.scale ? `transform: scale(${app.scale})` : ''];
			img.setAttribute('style', transforms.filter(Boolean).join(';'));
			img.addEventListener('error', () => {
				img.remove();
				fallback.style.display = 'flex';
			});
			iconWrap.append(img);
		} else {
			fallback.style.display = 'flex';
		}
		iconWrap.append(fallback);
		inner.append(iconWrap, el('p', 'app-name', app.name));

		card.append(el('span', 'spotlight'), el('span', 'border-glow'), del, inner);
		card.querySelector('.spotlight')?.setAttribute('aria-hidden', 'true');
		card.querySelector('.border-glow')?.setAttribute('aria-hidden', 'true');
		return card;
	}

	function renderCategory(cat: Category): HTMLElement {
		const section = el('section', 'category');
		section.dataset.id = cat.id;

		const title = el('h2', 'category-title');
		const handle = el('span', 'drag-handle');
		handle.innerHTML = handleIcon;
		handle.setAttribute('aria-hidden', 'true');

		const actions = el('span', 'cat-actions');
		const edit = el('button', 'cat-btn', 'Bearbeiten');
		edit.type = 'button';
		edit.dataset.action = 'edit-category';
		actions.append(edit);

		title.append(handle, document.createTextNode(cat.name), actions);

		const grid = el('div', 'grid');
		grid.append(...cat.apps.map(renderCard));
		section.append(title, grid);
		return section;
	}

	function render(): void {
		container.replaceChildren(...state.categories.map(renderCategory));
		$('empty-state').hidden = state.categories.length > 0;
	}

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function toast(message: string): void {
		const node = $('toast');
		node.textContent = message;
		node.classList.add('is-visible');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => node.classList.remove('is-visible'), 4000);
	}

	// ── Edit mode ──

	function setEditing(on: boolean): void {
		editing = on;
		document.body.classList.toggle('is-editing', on);
		$('btn-edit').setAttribute('aria-pressed', String(on));
		$('btn-add-app').classList.toggle('fab--hidden', !on);
	}

	$('btn-edit').addEventListener('click', () => setEditing(!editing));
	$('btn-add-app').addEventListener('click', () => openAppForm(null));

	// ── Modals ──

	function openModal(id: string): void {
		const modal = $(id);
		modal.removeAttribute('inert');
		modal.setAttribute('aria-hidden', 'false');
		modal.classList.add('is-open');
	}

	function closeModal(modal: HTMLElement): void {
		modal.classList.remove('is-open');
		modal.setAttribute('aria-hidden', 'true');
		modal.setAttribute('inert', '');
	}

	document.querySelectorAll<HTMLElement>('.modal-overlay').forEach((modal) => {
		modal.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (target === modal || target.closest('[data-close]')) closeModal(modal);
		});
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') document.querySelectorAll<HTMLElement>('.modal-overlay.is-open').forEach(closeModal);
	});

	// ── App form ──

	const form = {
		name: $<HTMLInputElement>('app-name'),
		url: $<HTMLInputElement>('app-url'),
		logo: $<HTMLInputElement>('app-logo'),
		category: $<HTMLSelectElement>('app-category'),
		newCategory: $<HTMLInputElement>('app-new-cat'),
		color: $<HTMLInputElement>('app-color'),
		autoColor: $<HTMLInputElement>('app-auto-color'),
		fullscreen: $<HTMLInputElement>('app-fullscreen'),
		error: $<HTMLElement>('form-error'),
	};
	let editingAppId: string | null = null;

	function findApp(id: string): { app: App; category: Category } | null {
		for (const category of state.categories) {
			const app = category.apps.find((a) => a.id === id);
			if (app) return { app, category };
		}
		return null;
	}

	function syncNewCategoryRow(): void {
		$('new-cat-row').hidden = form.category.value !== NEW_CATEGORY;
	}

	function openAppForm(appId: string | null): void {
		editingAppId = appId;
		const found = appId ? findApp(appId) : null;

		form.category.replaceChildren(
			...state.categories.map((c) => new Option(c.name, c.id)),
			new Option('+ Neue Kategorie …', NEW_CATEGORY),
		);
		form.name.value = found?.app.name ?? '';
		form.url.value = found?.app.url ?? '';
		form.logo.value = found?.app.logo ?? '';
		form.category.value = found?.category.id ?? state.categories[0]?.id ?? NEW_CATEGORY;
		form.newCategory.value = '';
		form.color.value = found?.app.color ?? '#e50914';
		form.autoColor.checked = !found;
		form.fullscreen.checked = found?.app.fullscreen ?? true;
		form.error.hidden = true;
		syncNewCategoryRow();

		$('app-form-title').textContent = found ? 'App bearbeiten' : 'App hinzufügen';
		$('app-submit').textContent = found ? 'Speichern' : 'Hinzufügen';
		$('app-delete').hidden = !found;
		openModal('modal-app');
		if (!found) form.name.focus();
	}

	form.category.addEventListener('change', syncNewCategoryRow);
	form.color.addEventListener('input', () => { form.autoColor.checked = false; });

	function showFormError(node: HTMLElement, message: string): void {
		node.textContent = message;
		node.hidden = false;
	}

	async function resolveColor(logo: string): Promise<string> {
		if (!form.autoColor.checked || !logo) return form.color.value;
		try {
			const res = await fetch('/api/color', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ logo }),
			});
			if (res.ok) return (await res.json()).color;
		} catch {
			// fall back to the picker value
		}
		return form.color.value;
	}

	$('app-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const name = form.name.value.trim();
		const url = normalizeUrl(form.url.value);
		const rawLogo = form.logo.value.trim();
		const logo = rawLogo && !rawLogo.startsWith('/logos/') ? normalizeUrl(rawLogo) : rawLogo;
		const newCategoryName = form.newCategory.value.trim();

		if (!name) return showFormError(form.error, 'Bitte einen Namen eingeben.');
		if (!url) return showFormError(form.error, 'Bitte eine gültige URL eingeben.');
		if (logo === null) return showFormError(form.error, 'Die Logo-URL ist ungültig.');
		if (form.category.value === NEW_CATEGORY && !newCategoryName) {
			return showFormError(form.error, 'Bitte einen Namen für die neue Kategorie eingeben.');
		}

		const submit = $<HTMLButtonElement>('app-submit');
		submit.disabled = true;
		const color = await resolveColor(logo);
		submit.disabled = false;

		const appId = editingAppId;
		const isNewCategory = form.category.value === NEW_CATEGORY;
		const targetCategoryId = isNewCategory ? crypto.randomUUID() : form.category.value;
		const fullscreen = form.fullscreen.checked;

		closeModal($('modal-app'));
		await commit((draft) => {
			if (isNewCategory || !draft.categories.some((c) => c.id === targetCategoryId)) {
				draft.categories.push({ id: targetCategoryId, name: newCategoryName || 'Apps', apps: [] });
			}
			const target = draft.categories.find((c) => c.id === targetCategoryId)!;
			let app: App = { id: appId ?? crypto.randomUUID(), name, url, logo, color, fullscreen };

			if (appId) {
				for (const cat of draft.categories) {
					const index = cat.apps.findIndex((a) => a.id === appId);
					if (index === -1) continue;
					const previous = cat.apps[index];
					// Keep display tweaks from the seed config that the form does not expose.
					app = { ...app, ...(previous.invert ? { invert: true } : {}), ...(previous.scale ? { scale: previous.scale } : {}) };
					if (cat.id === target.id) {
						cat.apps[index] = app;
						return;
					}
					cat.apps.splice(index, 1);
				}
			}
			target.apps.push(app);
		});
	});

	function deleteApp(appId: string): Promise<void> {
		return commit((draft) => {
			for (const cat of draft.categories) cat.apps = cat.apps.filter((a) => a.id !== appId);
		});
	}

	$('app-delete').addEventListener('click', () => {
		if (!editingAppId) return;
		closeModal($('modal-app'));
		deleteApp(editingAppId);
	});

	// ── Category form ──

	let editingCategoryId: string | null = null;

	function openCategoryForm(categoryId: string): void {
		const category = state.categories.find((c) => c.id === categoryId);
		if (!category) return;
		editingCategoryId = categoryId;
		$<HTMLInputElement>('cat-name').value = category.name;
		$('cat-error').hidden = true;
		const deleteButton = $('cat-delete');
		deleteButton.textContent = category.apps.length ? `Löschen (mit ${category.apps.length} Apps)` : 'Löschen';
		openModal('modal-category');
	}

	$('cat-form').addEventListener('submit', (e) => {
		e.preventDefault();
		const name = $<HTMLInputElement>('cat-name').value.trim();
		if (!name) return showFormError($('cat-error'), 'Bitte einen Namen eingeben.');
		const id = editingCategoryId;
		closeModal($('modal-category'));
		commit((draft) => {
			const category = draft.categories.find((c) => c.id === id);
			if (category) category.name = name;
		});
	});

	$('cat-delete').addEventListener('click', () => {
		const id = editingCategoryId;
		closeModal($('modal-category'));
		commit((draft) => {
			draft.categories = draft.categories.filter((c) => c.id !== id);
		});
	});

	// ── Clicks on cards and category buttons ──

	let suppressClick = false;

	container.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		if (suppressClick) {
			e.preventDefault();
			suppressClick = false;
			return;
		}
		const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
		if (action === 'edit-category') {
			openCategoryForm(target.closest<HTMLElement>('.category')!.dataset.id!);
			return;
		}
		const card = target.closest<HTMLElement>('.card');
		if (!card || !editing) return;
		e.preventDefault();
		if (action === 'delete-app') deleteApp(card.dataset.id!);
		else openAppForm(card.dataset.id!);
	});

	// Spotlight follows the mouse on desktop.
	container.addEventListener('pointermove', (e) => {
		if (e.pointerType !== 'mouse') return;
		const card = (e.target as HTMLElement).closest<HTMLElement>('.card');
		if (!card) return;
		const rect = card.getBoundingClientRect();
		card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
		card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
	});

	// ── Drag & drop (edit mode): cards between grids, categories by their handle ──

	interface DragSession {
		kind: 'card' | 'category';
		node: HTMLElement;
		ghost: HTMLElement;
		offsetX: number;
		offsetY: number;
	}

	let drag: DragSession | null = null;
	let lastPointer = { x: 0, y: 0 };

	// Scroll the page while a dragged item is held near the top or bottom edge.
	function autoScroll(): void {
		if (!drag) return;
		const edge = 90;
		const { y } = lastPointer;
		const speed = y > window.innerHeight - edge ? 14 : y < edge ? -14 : 0;
		if (speed) {
			window.scrollBy(0, speed);
			moveDrag(lastPointer.x, lastPointer.y);
		}
		requestAnimationFrame(autoScroll);
	}
	let pending: { node: HTMLElement; kind: 'card' | 'category'; x: number; y: number; pointerId: number; timer?: ReturnType<typeof setTimeout> } | null = null;

	function startDrag(x: number, y: number): void {
		if (!pending) return;
		const { node, kind } = pending;
		clearTimeout(pending.timer);
		pending = null;

		const rect = node.getBoundingClientRect();
		const ghost = node.cloneNode(true) as HTMLElement;
		ghost.classList.add('touch-ghost');
		ghost.style.width = `${rect.width}px`;
		ghost.style.height = `${rect.height}px`;
		ghost.style.left = `${rect.left}px`;
		ghost.style.top = `${rect.top}px`;
		document.body.append(ghost);
		node.classList.add('is-dragging');
		drag = { kind, node, ghost, offsetX: x - rect.left, offsetY: y - rect.top };
		lastPointer = { x, y };
		requestAnimationFrame(autoScroll);
	}

	function moveDrag(x: number, y: number): void {
		if (!drag) return;
		drag.ghost.style.left = `${x - drag.offsetX}px`;
		drag.ghost.style.top = `${y - drag.offsetY}px`;

		drag.ghost.style.display = 'none';
		const under = document.elementFromPoint(x, y) as HTMLElement | null;
		drag.ghost.style.display = '';
		if (!under) return;

		if (drag.kind === 'category') {
			const target = under.closest<HTMLElement>('.category');
			if (!target || target === drag.node) return;
			const rect = target.getBoundingClientRect();
			container.insertBefore(drag.node, y < rect.top + rect.height / 2 ? target : target.nextSibling);
			return;
		}

		const targetCard = under.closest<HTMLElement>('.card');
		if (targetCard && targetCard !== drag.node) {
			const rect = targetCard.getBoundingClientRect();
			targetCard.parentElement!.insertBefore(drag.node, x < rect.left + rect.width / 2 ? targetCard : targetCard.nextSibling);
			return;
		}
		const grid = under.closest<HTMLElement>('.category')?.querySelector<HTMLElement>('.grid');
		if (grid && !targetCard && drag.node.parentElement !== grid) grid.append(drag.node);
	}

	function endDrag(): void {
		if (!drag) return;
		const { node, ghost } = drag;
		ghost.remove();
		node.classList.remove('is-dragging');
		drag = null;
		suppressClick = true;
		setTimeout(() => { suppressClick = false; }, 0);

		// The DOM now holds the new order; write it back into the state.
		const order = [...container.querySelectorAll<HTMLElement>('.category')].map((section) => ({
			id: section.dataset.id!,
			apps: [...section.querySelectorAll<HTMLElement>('.card')].map((card) => card.dataset.id!),
		}));
		commit((draft) => {
			const apps = new Map(draft.categories.flatMap((c) => c.apps.map((a) => [a.id, a] as const)));
			const categories = new Map(draft.categories.map((c) => [c.id, c]));
			draft.categories = order
				.filter((o) => categories.has(o.id))
				.map((o) => ({ ...categories.get(o.id)!, apps: o.apps.filter((id) => apps.has(id)).map((id) => apps.get(id)!) }));
		});
	}

	function cancelPending(): void {
		if (pending) clearTimeout(pending.timer);
		pending = null;
	}

	container.addEventListener('pointerdown', (e) => {
		if (!editing || e.button !== 0) return;
		const target = e.target as HTMLElement;
		if (target.closest('[data-action]')) return;

		const handle = target.closest<HTMLElement>('.drag-handle');
		const node = handle ? handle.closest<HTMLElement>('.category') : target.closest<HTMLElement>('.card');
		if (!node) return;

		pending = { node, kind: handle ? 'category' : 'card', x: e.clientX, y: e.clientY, pointerId: e.pointerId };
		// Touch: hold still briefly to pick a card up, so a normal swipe still scrolls the page.
		if (e.pointerType !== 'mouse' || handle) {
			const { clientX, clientY } = e;
			pending.timer = setTimeout(() => startDrag(clientX, clientY), handle ? 0 : LONG_PRESS_MS);
		}
		if (handle) e.preventDefault();
	});

	document.addEventListener('pointermove', (e) => {
		if (drag) {
			lastPointer = { x: e.clientX, y: e.clientY };
			moveDrag(e.clientX, e.clientY);
			return;
		}
		if (!pending || e.pointerId !== pending.pointerId) return;
		const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > DRAG_START_PX;
		if (!moved) return;
		if (e.pointerType === 'mouse') startDrag(e.clientX, e.clientY);
		else cancelPending(); // finger moved before the long press: it's a scroll
	});

	document.addEventListener('pointerup', () => {
		cancelPending();
		endDrag();
	});
	document.addEventListener('pointercancel', () => {
		cancelPending();
		endDrag();
	});

	// While dragging with a finger, stop the browser from scrolling (and cancelling the pointer).
	document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
	// Suppress the long-press context menu on cards in edit mode.
	container.addEventListener('contextmenu', (e) => { if (editing) e.preventDefault(); });
	// Native link dragging would fight our own drag.
	container.addEventListener('dragstart', (e) => e.preventDefault());

	// ── Start ──

	// A tab left open in the car picks up edits made elsewhere when it comes back into view.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && !drag) fetchState().catch(() => undefined);
	});

	fetchState().catch((err) => {
		console.error('[tesla] load failed', err);
		toast('Laden fehlgeschlagen.');
	});
}
