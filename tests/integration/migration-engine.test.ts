import { afterEach, describe, expect, it } from 'vitest';
import { TARGET_YARN_VERSION } from '../helpers/context.ts';
import { writeNpmProject, writeYarn1Project } from '../helpers/fixtures.ts';
import { runMigration } from '../helpers/run-migration.ts';
import { readStubLog, STUB_ERROR, STUB_LOG, writeStubYarnRelease } from '../helpers/stub-yarn.ts';
import { createWorkspace } from '../helpers/workspace.ts';

const RELEASE = `.yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs`;

// The whole point of the stub: everything up to and including the install runs for real
const FULL_RUN = { install: true } as const;

afterEach(() => {
	delete process.env.DRILLBIT_STUB_FAIL;
});

describe('npm → Yarn', () => {
	it('rewrites the project and installs with the vendored release', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, {
				dependencies: { 'left-pad': '^1.3.0' },
				gitignore: 'dist\n',
				name: 'demo',
				npmrc: 'registry=https://registry.npmjs.org/\n--network-timeout 90000\n',
				stubYarnRelease: true,
			});

			const { details, stepIds } = await runMigration(workspace, FULL_RUN);

			expect(stepIds).toStrictEqual([
				'vendor-yarn',
				'clean-install-artifacts',
				'remove-npm-lockfiles',
				'migrate-npmrc',
				'write-yarnrc-yml',
				'set-package-manager',
				'update-gitignore',
				'install',
			]);
			expect(details.get('vendor-yarn')).toStrictEqual([`${RELEASE} is already vendored`]);
			expect(details.get('remove-npm-lockfiles')).toContain('Removed package-lock.json');
			expect(details.get('migrate-npmrc')).toStrictEqual([
				'Mapped npmRegistryServer: "https://registry.npmjs.org/"',
				'Mapped httpTimeout: 90000',
			]);

			expect(await workspace.read('.yarnrc.yml')).toBe(
				[
					'nodeLinker: node-modules',
					'npmRegistryServer: https://registry.npmjs.org/',
					'httpTimeout: 90000',
					`yarnPath: ${RELEASE}`,
					'',
				].join('\n')
			);
			expect(await workspace.read('package.json')).toContain(`"packageManager": "yarn@${TARGET_YARN_VERSION}"`);

			expect(workspace.exists('package-lock.json')).toBe(false);
			// The stub stands in for Yarn, so a freshly generated Berry lockfile is the proof the install actually ran
			expect(await workspace.read('yarn.lock')).toContain('__metadata:');
			expect(await workspace.read('node_modules/left-pad/package.json')).toContain('"name": "left-pad"');

			const gitignore = await workspace.read('.gitignore');
			expect(gitignore.startsWith('dist\n\n')).toBe(true);
			expect(gitignore).toContain('!.yarn/releases');
			expect(gitignore).toContain('node_modules/');

			expect(await readStubLog(workspace)).toStrictEqual([
				{ args: ['install'], cwd: workspace.dir, version: TARGET_YARN_VERSION },
			]);
		} finally {
			await workspace.cleanup();
		}
	});

	it('skips the install with --no-install but still converts the project', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, { stubYarnRelease: true });
			const { details } = await runMigration(workspace, { install: false });

			expect(details.get('install')).toStrictEqual(['Skipped because --no-install was passed']);
			expect(await readStubLog(workspace)).toStrictEqual([]);
			expect(workspace.exists('node_modules')).toBe(false);
			expect(workspace.exists('yarn.lock')).toBe(false);
			expect(await workspace.read('.yarnrc.yml')).toContain(`yarnPath: ${RELEASE}`);
		} finally {
			await workspace.cleanup();
		}
	});

	it('reports a failed install without pretending the migration succeeded', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, { stubYarnRelease: true });
			process.env.DRILLBIT_STUB_FAIL = '1';
			await expect(runMigration(workspace, FULL_RUN)).rejects.toThrow(
				/`yarn install` failed with exit code 1\. Fix the reported problems and run Drillbit again, or pass --no-install/
			);
			// Proof the failure came from the install command rather than an earlier step
			expect(await workspace.read(STUB_ERROR)).toBe('STUB_FAIL: refusing to install\n');
		} finally {
			await workspace.cleanup();
		}
	});

	it('never writes registry credentials into .yarnrc.yml', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, {
				npmrc: '//registry.npmjs.org/:_authToken=super-secret\nregistry=https://registry.npmjs.org/\n',
				stubYarnRelease: true,
			});
			const { plan } = await runMigration(workspace, FULL_RUN);

			expect(await workspace.read('.yarnrc.yml')).not.toContain('super-secret');
			expect(plan.warnings.some((warning) => warning.includes('never copies secrets'))).toBe(true);
		} finally {
			await workspace.cleanup();
		}
	});

	it('is idempotent: a second run leaves the project unchanged', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, { gitignore: 'dist\n', stubYarnRelease: true });
			await runMigration(workspace, FULL_RUN);
			await workspace.remove(STUB_LOG);
			const afterFirstRun = await workspace.snapshot();

			const second = await runMigration(workspace, FULL_RUN);
			await workspace.remove(STUB_LOG);

			expect(second.stepIds).not.toContain('update-gitignore');
			expect(second.stepIds).not.toContain('remove-npm-lockfiles');
			expect(second.details.get('vendor-yarn')).toStrictEqual([`${RELEASE} is already vendored`]);
			expect(await workspace.snapshot()).toStrictEqual(afterFirstRun);
		} finally {
			await workspace.cleanup();
		}
	});
});

describe('Yarn 1.22.12 → Yarn', () => {
	it('maps .yarnrc, prunes the old release and converts the lockfile', async () => {
		const workspace = await createWorkspace();
		try {
			await writeYarn1Project(workspace, { gitignore: 'dist\n', vendorYarn1Release: true });
			await writeStubYarnRelease(workspace);

			const { details, plan, stepIds } = await runMigration(workspace, FULL_RUN);

			expect(stepIds).toStrictEqual([
				'vendor-yarn',
				'prune-releases',
				'clean-install-artifacts',
				'migrate-yarnrc',
				'write-yarnrc-yml',
				'set-package-manager',
				'update-gitignore',
				'install',
			]);
			expect(details.get('prune-releases')).toStrictEqual(['Removed .yarn/releases/yarn-1.22.12.cjs']);
			expect(details.get('migrate-yarnrc')).toContain('Removed .yarnrc (Yarn 4 ignores it)');
			expect(plan.warnings.some((warning) => warning.includes('nohoist'))).toBe(true);

			expect(workspace.exists('.yarnrc')).toBe(false);
			expect(workspace.exists('.yarn/releases/yarn-1.22.12.cjs')).toBe(false);
			expect(await workspace.read('.yarnrc.yml')).toBe(
				[
					'nodeLinker: node-modules',
					'npmRegistryServer: https://registry.example.test',
					'httpTimeout: 60000',
					'enableScripts: false',
					`yarnPath: ${RELEASE}`,
					'',
				].join('\n')
			);
			expect(await workspace.read('package.json')).toContain(`"packageManager": "yarn@${TARGET_YARN_VERSION}"`);
		} finally {
			await workspace.cleanup();
		}
	});

	it('keeps the layout when the project asks for Plug’n’Play', async () => {
		const workspace = await createWorkspace();
		try {
			await writeNpmProject(workspace, { gitignore: 'dist\n', stubYarnRelease: true });
			await runMigration(workspace, { ...FULL_RUN, linker: 'pnp' });

			expect(await workspace.read('.yarnrc.yml')).toContain('nodeLinker: pnp');
			const gitignore = await workspace.read('.gitignore');
			expect(gitignore).toContain('.pnp.*');
			expect(gitignore).not.toContain('node_modules/');
		} finally {
			await workspace.cleanup();
		}
	});
});
