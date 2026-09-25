import { describe, expect, it } from 'vitest';
import { planYarnGitignore } from '../../../src/core/gitignore.ts';

const BLOCK = ['.yarn/*', '!.yarn/patches', '!.yarn/plugins', '!.yarn/releases', '!.yarn/sdks', '!.yarn/versions'];

describe('planYarnGitignore', () => {
	it('writes the whole block into an empty project', () => {
		const update = planYarnGitignore(null, 'node-modules');
		expect(update.additions).toStrictEqual([...BLOCK, 'node_modules/']);
		expect(update.content).toBe(`${[...BLOCK, 'node_modules/'].join('\n')}\n`);
	});

	it('keeps the vendored release out of the ignore rule', () => {
		const update = planYarnGitignore(null, 'pnp');
		expect(update.additions).toContain('.yarn/*');
		expect(update.additions).toContain('!.yarn/releases');
		expect(update.additions).not.toContain('node_modules/');
		expect(update.additions).toContain('.pnp.*');
	});

	it('preserves CRLF files', () => {
		const update = planYarnGitignore('dist/\r\n', 'node-modules');
		expect(update.content.startsWith('dist/\r\n\r\n')).toBe(true);
		expect(/(?<!\r)\n/.test(update.content)).toBe(false);
	});

	it('skips patterns that are already covered', () => {
		const existing = ['node_modules/', '.yarn/*', '!.yarn/releases', '.pnp.cjs'].join('\n');
		const update = planYarnGitignore(existing, 'node-modules');
		expect(update.additions).not.toContain('node_modules/');
		expect(update.additions).not.toContain('.yarn/*');
		expect(update.additions).not.toContain('!.yarn/releases');
		expect(update.additions).toContain('!.yarn/sdks');
	});

	it('treats any .pnp entry as covering the generated files', () => {
		const update = planYarnGitignore('.pnp.cjs\n', 'pnp');
		expect(update.additions).not.toContain('.pnp.*');
	});

	it('is idempotent', () => {
		const first = planYarnGitignore('coverage/\n', 'node-modules');
		const second = planYarnGitignore(first.content, 'node-modules');
		expect(second.additions).toStrictEqual([]);
		expect(second.content).toBe(first.content);
	});
});
