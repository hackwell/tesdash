// Request paths are decoded and checked once, before any access decision.

/** Decoded, normalised path for every access decision, or null for anything ambiguous. */
export function canonicalPath(rawPathname: string): string | null {
	if (/%2f|%5c|%00/i.test(rawPathname)) return null;
	let path: string;
	try {
		path = decodeURIComponent(rawPathname);
	} catch {
		return null;
	}
	if (path.includes('\\') || path.split('/').some((segment) => segment === '..' || segment === '.')) return null;
	return path;
}
