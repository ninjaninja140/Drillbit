import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../helpers/entrypoint.ts';
import { TARGET_YARN_VERSION } from '../helpers/context.ts';
import { writeNpmProject, writePnpmProject, writeYarn1Project } from '../helpers/fixtures.ts';
import { readStubLog } from '../helpers/stub-yarn.ts';
import { createWorkspace, type Workspace } from '../helpers/workspace.ts';

// The suites elsewhere call `run()` in-process; this one spawns the real entrypoint the way a user
// does, so the exit codes, argv handling and child processes are all exercised for real.
const YES = ['migrate', '--yes', '--yarn-version', TARGET_YARN_VERSION];

let workspace: Workspace;

beforeEach(async () => {
	workspace = await createWorkspace('drillbit-e2e-');
});

afterEach(async () => {
	await workspace.cleanup();
});

describe('drillbit CLI', () => {
	it('reports its version', async () => {
		const result = await runCli(['--version'], { cwd: workspace.dir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});

	it('reports its usage', async () => {
		const result = await runCli(['--help'], { cwd: workspace.dir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Usage');
		expect(result.stdout).toContain('migrate [directory]');
	});

	it('shows the help of a single command', async () => {
		const result = await runCli(['help', 'migrate'], { cwd: workspace.dir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('drillbit migrate [directory] [options]');
		expect(result.stdout).toContain('npm      → Yarn (latest)');
	});

	it('exits 2 instead of working without a command', async () => {
		const result = await runCli([], { cwd: workspace.dir });
		expect(result.exitCode).toBe(2);
		expect(`${result.stdout}${result.stderr}`).toContain('needs a command');
	});

	it('exits 2 instead of prompting when stdin is not a terminal', async () => {
		await writeNpmProject(workspace, { packageManager: 'npm@10.5.0', stubYarnRelease: true });
		const result = await runCli(['migrate', workspace.dir], { cwd: workspace.dir });
		expect(result.exitCode).toBe(2);
		expect(`${result.stdout}${result.stderr}`).toContain('interactive terminal');
		expect(workspace.exists('package-lock.json')).toBe(true);
	});

	it('exits 2 on an unknown option', async () => {
		const result = await runCli(['--definitely-not-a-flag'], { cwd: workspace.dir });
		expect(result.exitCode).toBe(2);
		expect(`${result.stdout}${result.stderr}`).toContain('Unknown option');
	});

	it('refuses a project it cannot convert', async () => {
		await writePnpmProject(workspace);
		const result = await runCli(YES, { cwd: workspace.dir });
		expect(result.exitCode).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('Converting pnpm projects is not supported yet');
	});

	it('converts an npm project to Yarn', async () => {
		await writeNpmProject(workspace, {
			dependencies: { 'left-pad': '^1.3.0' },
			gitignore: 'dist\n',
			name: 'e2e-npm',
			packageManager: 'npm@10.5.0',
			stubYarnRelease: true,
		});

		const result = await runCli(YES, { cwd: workspace.dir });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`Now using Yarn ${TARGET_YARN_VERSION} (node-modules linker).`);
		expect(await readStubLog(workspace)).toStrictEqual([
			{ args: ['install'], cwd: workspace.dir, version: TARGET_YARN_VERSION },
		]);
		expect(workspace.exists('package-lock.json')).toBe(false);
		expect(workspace.exists('node_modules/left-pad/package.json')).toBe(true);
		expect(await workspace.read('.yarnrc.yml')).toContain(
			`yarnPath: .yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs`
		);
		expect(await workspace.read('.gitignore')).toContain('dist\n\n.yarn/*');
	});

	it('writes nothing on a dry run', async () => {
		await writeNpmProject(workspace, { packageManager: 'npm@10.5.0', stubYarnRelease: true });
		const before = await workspace.snapshot();

		const result = await runCli(YES.concat(['--dry-run']), { cwd: workspace.dir });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Dry run: no files were written.');
		expect(await workspace.snapshot()).toStrictEqual(before);
	});

	it('reports a failing install without claiming success', async () => {
		await writeNpmProject(workspace, { packageManager: 'npm@10.5.0', stubYarnRelease: true });
		const result = await runCli(YES, { cwd: workspace.dir, env: { DRILLBIT_STUB_FAIL: '1' } });

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain('may be half-migrated');
		expect(workspace.exists('yarn.lock')).toBe(false);
	});
});

// The only tests that touch the network. Run them with
// `DRILLBIT_E2E_NETWORK=1 node .yarn/releases/yarn-4.18.0.cjs vitest run tests/e2e`.
describe.runIf(process.env.DRILLBIT_E2E_NETWORK === '1')('drillbit CLI against the real registry', () => {
	it('downloads Yarn and installs a real dependency tree', async () => {
		await writeNpmProject(workspace, {
			dependencies: { 'is-number': '^7.0.0' },
			name: 'e2e-live',
			packageManager: 'npm@10.5.0',
		});

		const result = await runCli(YES, { cwd: workspace.dir, timeoutMs: 180_000 });

		expect(result.exitCode).toBe(0);
		expect(workspace.exists(`.yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs`)).toBe(true);
		expect(await workspace.read('yarn.lock')).toContain('# This file is generated by running "yarn install"');
		expect(workspace.exists('node_modules/is-number/package.json')).toBe(true);
		expect(await readStubLog(workspace)).toStrictEqual([]);
	}, 180_000);

	it('installs nothing with --no-install while still vendoring Yarn', async () => {
		await writeNpmProject(workspace, { packageManager: 'npm@10.5.0' });

		const result = await runCli(YES.concat(['--no-install']), { cwd: workspace.dir, timeoutMs: 180_000 });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Dependencies were not installed (--no-install).');
		expect(workspace.exists('yarn.lock')).toBe(false);
		expect(workspace.exists(`.yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs`)).toBe(true);
	}, 180_000);

	it('upgrades a Yarn 1 project for real', async () => {
		// `YARN1_RC` points at a fake registry. Drillbit deliberately carries that
		// setting into `.yarnrc.yml`, so a live install would never resolve.
		await writeYarn1Project(workspace, {
			vendorYarn1Release: false,
			yarnrc: ['registry "https://registry.npmjs.org"', 'yarn-path ".yarn/releases/yarn-1.22.12.cjs"', ''].join(
				'\n'
			),
		});

		const result = await runCli(YES, { cwd: workspace.dir, timeoutMs: 180_000 });

		expect(result.exitCode).toBe(0);
		expect(workspace.exists('.yarnrc')).toBe(false);
		expect(await workspace.read('yarn.lock')).toContain('__metadata:');
	}, 180_000);
});
