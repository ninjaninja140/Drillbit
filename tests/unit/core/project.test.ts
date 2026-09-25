import { describe, expect, it } from 'vitest';
import { writeNpmProject, writeYarn1Project } from '../../helpers/fixtures.ts';
import { createWorkspace } from '../../helpers/workspace.ts';
import { readProject } from '../../../src/core/project.ts';

describe('readProject', () => {
	it('reads an npm project', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, {
				dependencies: { 'left-pad': '^1.3.0' },
				gitignore: 'dist\n',
				lockfileVersion: 3,
				name: 'demo',
				npmrc: 'registry=https://registry.npmjs.org/\n',
			});
			const project = await readProject(workspace.dir);

			expect(project.cwd).toBe(workspace.dir);
			expect(project.packageJson?.name).toBe('demo');
			expect(project.packageJsonRaw).toMatch(/"name": "demo"/);
			expect(project.lockfiles.map((entry) => entry.path)).toStrictEqual(['package-lock.json']);
			expect(project.packageLock?.lockfileVersion).toBe(3);
			expect(project.npmrc).toBe('registry=https://registry.npmjs.org/\n');
			expect(project.gitignore).toBe('dist\n');
			expect(project.nodeModulesExists).toBe(true);
			expect(project.yarnLock).toBeNull();
			expect(project.yarnrcYml).toBeNull();
			expect(project.legacyYarnrc).toBeNull();
		} finally {
			await workspace.cleanup();
		}
	});

	it('reads a Yarn 1 project including its vendored release', async () => {
		const workspace = await createWorkspace();
		try {
			await writeYarn1Project(workspace, { vendorYarn1Release: true });
			const project = await readProject(workspace.dir);

			expect(project.lockfiles.map((entry) => entry.path)).toStrictEqual(['yarn.lock']);
			expect(project.yarnLock?.raw).toContain('# yarn lockfile v1');
			expect(project.legacyYarnrc).toContain('nohoist **');
			expect(project.vendoredYarnReleases).toStrictEqual(['yarn-1.22.12.cjs']);
		} finally {
			await workspace.cleanup();
		}
	});

	it('collects every lockfile and remembers which one is newest', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace);
			await workspace.write('yarn.lock', '# yarn lockfile v1\n');
			await workspace.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
			await workspace.touch('package-lock.json', new Date('2024-01-01T00:00:00Z').getTime());
			await workspace.touch('yarn.lock', new Date('2024-06-01T00:00:00Z').getTime());
			await workspace.touch('pnpm-lock.yaml', new Date('2024-03-01T00:00:00Z').getTime());

			const project = await readProject(workspace.dir);
			const byPath = new Map(project.lockfiles.map((entry) => [entry.path, entry]));

			expect([...byPath.keys()].sort()).toStrictEqual(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
			expect(byPath.get('yarn.lock')?.manager).toBe('yarn');
			expect(byPath.get('pnpm-lock.yaml')?.manager).toBe('pnpm');
			expect(byPath.get('yarn.lock')?.mtimeMs).toBeGreaterThan(byPath.get('pnpm-lock.yaml')?.mtimeMs ?? 0);
			expect(byPath.get('pnpm-lock.yaml')?.mtimeMs).toBeGreaterThan(
				byPath.get('package-lock.json')?.mtimeMs ?? 0
			);
		} finally {
			await workspace.cleanup();
		}
	});

	it('prefers package-lock.json over npm-shrinkwrap.json for the structured snapshot', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, { lockfileVersion: 3 });
			await workspace.write('npm-shrinkwrap.json', '{"lockfileVersion":1}\n');
			const project = await readProject(workspace.dir);
			expect(project.packageLock?.path).toBe('package-lock.json');
			expect(project.packageLock?.lockfileVersion).toBe(3);
		} finally {
			await workspace.cleanup();
		}
	});

	it('reports a lockfile whose version it cannot read', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace);
			await workspace.write('package-lock.json', '{ not json\n');
			const project = await readProject(workspace.dir);
			expect(project.packageLock?.lockfileVersion).toBeNull();
		} finally {
			await workspace.cleanup();
		}
	});

	it('lists only real Yarn releases, sorted', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace);
			await workspace.write('.yarn/releases/yarn-4.18.0.cjs', '// release\n');
			await workspace.write('.yarn/releases/yarn-1.22.12.cjs', '// release\n');
			await workspace.write('.yarn/releases/yarn-4.0.0.js', '// release\n');
			await workspace.write('.yarn/releases/yarn-update-index.json', '{}');
			await workspace.write('.yarn/releases/README.md', 'not a release');

			const project = await readProject(workspace.dir);
			expect(project.vendoredYarnReleases).toStrictEqual([
				'yarn-1.22.12.cjs',
				'yarn-4.0.0.js',
				'yarn-4.18.0.cjs',
			]);
		} finally {
			await workspace.cleanup();
		}
	});

	it('rejects a package.json that is not valid JSON', async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.write('package.json', '{ oops\n');
			await expect(readProject(workspace.dir)).rejects.toThrow(/package\.json is not valid JSON/);
		} finally {
			await workspace.cleanup();
		}
	});

	it('reports an empty directory as an empty snapshot', async () => {
		const workspace = await createWorkspace();
		try {
			const project = await readProject(workspace.dir);
			expect(project.packageJson).toBeNull();
			expect(project.packageJsonRaw).toBeNull();
			expect(project.lockfiles).toStrictEqual([]);
			expect(project.nodeModulesExists).toBe(false);
			expect(project.vendoredYarnReleases).toStrictEqual([]);
		} finally {
			await workspace.cleanup();
		}
	});
});
