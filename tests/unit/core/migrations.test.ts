import { describe, expect, it } from 'vitest';
import { createContext, lockfile, packageLock, snapshot, yarnLock } from '../../helpers/context.ts';
import { runMigration } from '../../helpers/run-migration.ts';
import { createWorkspace } from '../../helpers/workspace.ts';
import { planMigration, planYarn4Migration } from '../../../src/core/migrations.ts';
import type { MigrationStep } from '../../../src/core/types.ts';
import { yarnReleaseRelativePath } from '../../../src/core/yarn.ts';

function stepIds(plan: { steps: MigrationStep[] }): string[] {
	return plan.steps.map((step) => step.id);
}

describe('planMigration', () => {
	it('turns an npm project into a full npm → Yarn conversion', () => {
		const plan = planMigration(
			createContext(
				snapshot({
					gitignore: 'dist\n',
					lockfiles: [lockfile('npm', 'package-lock.json', 1)],
					packageJson: { devDependencies: {}, name: 'demo' },
					packageJsonRaw: '{\n  "name": "demo"\n}\n',
					packageLock: packageLock(3, 1),
				})
			)
		);
		expect(plan.title).toBe('Convert npm to Yarn');
		expect(stepIds(plan)).toStrictEqual([
			'vendor-yarn',
			'clean-install-artifacts',
			'remove-npm-lockfiles',
			'write-yarnrc-yml',
			'set-package-manager',
			'update-gitignore',
			'install',
		]);
		expect(plan.warnings).toStrictEqual([]);
	});

	it('rejects unsupported sources with a useful message', () => {
		expect(() =>
			planMigration(createContext(snapshot({ lockfiles: [lockfile('pnpm', 'pnpm-lock.yaml', 1)] })))
		).toThrow(/Converting pnpm projects is not supported yet/);
		expect(() => planMigration(createContext(snapshot()))).toThrow(/No package manager was detected/);
	});
});

describe('planYarn4Migration from Yarn 1', () => {
	it('maps .yarnrc, keeps yarn.lock and prunes the old release', () => {
		const plan = planYarn4Migration(
			createContext(
				snapshot({
					legacyYarnrc: 'registry "https://registry.npmjs.org"\n--network-timeout 60000\nnohoist **\n',
					lockfiles: [lockfile('yarn', 'yarn.lock', 1)],
					vendoredYarnReleases: ['yarn-1.22.12.cjs'],
					yarnLock: yarnLock('# yarn lockfile v1\n', 1),
				})
			),
			'yarn-classic'
		);
		expect(plan.title).toBe('Upgrade Yarn 1 to Yarn');
		expect(stepIds(plan)).toStrictEqual([
			'vendor-yarn',
			'prune-releases',
			'clean-install-artifacts',
			'migrate-yarnrc',
			'write-yarnrc-yml',
			'set-package-manager',
			'update-gitignore',
			'install',
		]);
		expect(plan.warnings.some((warning) => warning.includes('nohoist'))).toBe(true);
	});

	it('warns about the orphaned npm lockfile instead of deleting it', () => {
		const plan = planYarn4Migration(
			createContext(
				snapshot({
					lockfiles: [lockfile('npm', 'package-lock.json', 2), lockfile('yarn', 'yarn.lock', 1)],
					packageLock: packageLock(3, 2),
					yarnLock: yarnLock('# yarn lockfile v1\n', 1),
				})
			),
			'yarn-classic'
		);
		expect(stepIds(plan)).not.toContain('remove-npm-lockfiles');
		expect(
			plan.warnings.some((warning) => warning.includes('package-lock.json') && warning.includes('left in place'))
		).toBe(true);
	});
});

describe('planYarn4Migration for an existing Berry project', () => {
	it('only re-pins the release', () => {
		const plan = planYarn4Migration(
			createContext(
				snapshot({
					packageJson: { packageManager: 'yarn@4.0.0' },
					vendoredYarnReleases: [yarnReleaseRelativePath('4.18.0').replace('.yarn/releases/', '')],
					yarnrcYml: 'nodeLinker: node-modules\nyarnPath: .yarn/releases/yarn-4.18.0.cjs\n',
				})
			),
			'yarn-berry'
		);
		expect(plan.title).toBe('Re-pin Yarn');
		expect(stepIds(plan)).toStrictEqual([
			'vendor-yarn',
			'clean-install-artifacts',
			'write-yarnrc-yml',
			'set-package-manager',
			'update-gitignore',
			'install',
		]);
	});
});

describe('planned warnings', () => {
	it('calls out credentials and foreign lockfiles', () => {
		const plan = planYarn4Migration(
			createContext(
				snapshot({
					lockfiles: [lockfile('npm', 'package-lock.json', 1), lockfile('pnpm', 'pnpm-lock.yaml', 2)],
					npmrc: '//registry.npmjs.org/:_authToken=secret\nregistry=https://registry.npmjs.org/\n',
					packageLock: packageLock(3, 1),
				})
			),
			'npm'
		);
		expect(
			plan.warnings.some((warning) => warning.includes('_authToken') && warning.includes('never copies secrets'))
		).toBe(true);
		expect(
			plan.warnings.some((warning) => warning.includes('pnpm-lock.yaml') && warning.includes('left in place'))
		).toBe(true);
	});
});

describe('a dry run', () => {
	it('reports every change and writes nothing', async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.write('.gitignore', 'dist\n');
			await workspace.write('package-lock.json', '{"lockfileVersion":3,"name":"demo"}\n');
			await workspace.write('package.json', '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
			const before = await workspace.snapshot();

			const { details } = await runMigration(workspace, { dryRun: true });
			const all = [...details.values()].flat();

			expect(all.some((detail) => detail.startsWith('Would remove package-lock.json'))).toBe(true);
			expect(all.some((detail) => detail.startsWith('Would write'))).toBe(true);
			expect(all).toContain('Would run `yarn install`');
			expect(await workspace.snapshot()).toStrictEqual(before);
		} finally {
			await workspace.cleanup();
		}
	});
});
