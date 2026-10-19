let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
	const node = document.getElementById('toast')!;
	node.textContent = message;
	node.classList.add('is-visible');
	clearTimeout(timer);
	timer = setTimeout(() => node.classList.remove('is-visible'), 4000);
}
