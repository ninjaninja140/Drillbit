import { detectEol } from './fsx.ts';
import type { LinkerId } from './types.ts';

const YARN_BLOCK = ['.yarn/*', '!.yarn/patches', '!.yarn/plugins', '!.yarn/releases', '!.yarn/sdks', '!.yarn/versions'];

export interface GitignoreUpdate {
	// Lines that were appended; empty when nothing had to change.
	additions: string[];
	content: string;
}

function normalize(line: string): string {
	return line.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function isCovered(lines: string[], pattern: string): boolean {
	if (pattern.startsWith('.pnp')) {
		// Any existing `.pnp.*` style entry already covers the generated files.
		return lines.some((line) => normalize(line).startsWith('.pnp'));
	}
	return lines.some((line) => normalize(line) === normalize(pattern));
}

// Keeps the cached install artifacts out of git: the vendored Yarn release must stay committed while
// everything else Yarn writes into `.yarn/` is ignored.
export function planYarnGitignore(raw: string | null, linker: LinkerId): GitignoreUpdate {
	const eol = raw === null ? '\n' : detectEol(raw);
	const existing = raw === null ? '' : raw;
	const lines = existing.split(/\r?\n/);

	const wanted = [...YARN_BLOCK, linker === 'node-modules' ? 'node_modules/' : '.pnp.*'];
	const additions = wanted.filter((pattern) => !isCovered(lines, pattern));

	if (additions.length === 0) return { additions, content: existing };

	const prefix =
		existing === '' ? '' : existing.endsWith(`${eol}${eol}`) ? '' : existing.endsWith(eol) ? eol : `${eol}${eol}`;
	const content = `${existing}${prefix}${additions.join(eol)}${eol}`;
	return { additions, content };
}
