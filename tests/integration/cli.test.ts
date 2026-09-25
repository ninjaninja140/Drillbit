import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCliVersion } from '../../src/cli/args.ts';
import { run } from '../../src/cli/run.ts';
import {
	CLACK_CANCEL,
	clackState,
	loggedMessagesOf,
	queueConfirm,
	queueSelect,
	resetClackState,
} from '../helpers/clack-state.ts';
import { TARGET_YARN_VERSION } from '../helpers/context.ts';
import {
	packageJsonText,
	writeNpmProject,
	writePnpmProject,
	writeYarn1Project,
	yarn1LockText,
} from '../helpers/fixtures.ts';
import { captureOutput, pretendTty } from '../helpers/stdio.ts';
import { readStubLog, writeStubYarnRelease } from '../helpers/stub-yarn.ts';
import { createWorkspace, type Workspace } from '../helpers/workspace.ts';

vi.mock('@clack/prompts', async () => await import('../helpers/clack-mock.ts'));

// `run()` talks to `@clack/prompts` for everything the user sees, so this is the whole UI
const outros = (): string => clackState().outros.join('\n--\n');
const errors = (): string => loggedMessagesOf('error').join('\n');

const YES = ['migrate', '--yes', '--yarn-version', TARGET_YARN_VERSION];

// npm projects that declare their manager: the vendored Yarn release is itself a Yarn trace, so
// without the `packageManager` field every fixture would look like an ambiguous project.
const NPM_DECLARED = { packageManager: 'npm@10.5.0', stubYarnRelease: true } as const;

let workspace: Workspace;

beforeEach(async () => {
	resetClackState();
	workspace = await createWorkspace();
});

afterEach(async () => {
	await workspace.cleanup();
});

describe('run() argument handling', () => {
	it('prints the version and exits 0', async () => {
		const output = captureOutput();
		await expect(run(['--version'])).resolves.toBe(0);
		expect(output.stdout().trim()).toMatch(/^\d+\.\d+\.\d+/);
		expect(clackState().logs).toStrictEqual([]);
	});

	it('prints help and exits 0', async () => {
		const output = captureOutput();
		await expect(run(['--help'])).resolves.toBe(0);
		expect(output.stdout()).toContain('Drillbit — move a project from one package manager to another.');
		expect(output.stdout()).toContain('--yarn-version <v>');
	});

	it('prints the help of a single command', async () => {
		const output = captureOutput();
		await expect(run(['help', 'migrate'])).resolves.toBe(0);
		expect(output.stdout()).toContain('drillbit migrate [directory] [options]');
		expect(output.stdout()).toContain('npm      → Yarn (latest)');
	});

	it('asks for a command when none is given', async () => {
		const output = captureOutput();
		await expect(run([])).resolves.toBe(2);
		expect(output.stderr()).toContain('Usage');
		expect(errors()).toContain('needs a command');
	});

	it('rejects a command it does not know', async () => {
		const output = captureOutput();
		await expect(run(['migrte'])).resolves.toBe(2);
		expect(output.stderr()).toContain('Usage');
		expect(errors()).toContain('Unknown command "migrte"');
	});

	it.each([
		[['--nope'], 'Unknown option'],
		[['--linker', 'symlink'], '--linker must be either'],
		[['--yarn-version', '1.22.12'], '--yarn-version must be a Yarn 2+ release'],
		[['migrate', 'one', 'two'], 'Expected at most one directory'],
	])('rejects %j with the usage exit code', async (argv, expected) => {
		const output = captureOutput();
		await expect(run(argv)).resolves.toBe(2);
		expect(output.stderr()).toContain('Usage');
		expect(errors()).toContain(expected);
	});
});

describe('run() guards', () => {
	it('refuses to prompt when stdin is not a terminal', async () => {
		const output = captureOutput();
		await writeNpmProject(workspace, NPM_DECLARED);
		await expect(run(['migrate', workspace.dir])).resolves.toBe(2);
		expect(errors()).toContain('needs an interactive terminal');
		expect(errors()).toContain('--yes');
		expect(output.stdout()).toBe('');
		expect(workspace.exists('.yarnrc.yml')).toBe(false);
	});

	it('reports a missing package.json', async () => {
		await expect(run(['migrate', '--yes', workspace.dir])).resolves.toBe(1);
		expect(errors()).toContain('No package.json in');
	});

	it('reports a project without any package manager traces', async () => {
		await workspace.write('package.json', packageJsonText('bare', {}));
		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(1);
		expect(errors()).toContain('could not tell which package manager this project uses');
	});

	it('refuses to convert a manager it does not support yet', async () => {
		await writePnpmProject(workspace);
		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(1);
		expect(errors()).toContain('Converting pnpm projects is not supported yet');
	});
});

describe('run() conversions', () => {
	it('converts npm to Yarn with --yes and without asking anything', async () => {
		await writeNpmProject(workspace, { ...NPM_DECLARED, gitignore: 'dist\n', name: 'npm-demo' });
		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(0);

		expect(clackState().confirms).toStrictEqual([]);
		expect(clackState().selects).toStrictEqual([]);
		expect(outros()).toContain(`Now using Yarn ${TARGET_YARN_VERSION} (node-modules linker).`);
		expect(outros()).toContain('Dependencies installed and the lockfile is up to date.');
		expect(await readStubLog(workspace)).toStrictEqual([
			{ args: ['install'], cwd: workspace.dir, version: TARGET_YARN_VERSION },
		]);
		expect(workspace.exists('package-lock.json')).toBe(false);
		expect(await workspace.read('node_modules/left-pad/index.js')).toBe('module.exports = {};\n');
	});

	it('walks an interactive npm conversion through both prompts', async () => {
		pretendTty();
		await writeNpmProject(workspace, NPM_DECLARED);
		queueSelect('node-modules');
		queueConfirm(true);

		await expect(run(['migrate', '--yarn-version', TARGET_YARN_VERSION, workspace.dir])).resolves.toBe(0);
		expect(clackState().selects.map((call) => call.message)).toStrictEqual([
			'How should Yarn lay out node_modules?',
		]);
		expect(clackState().confirms).toStrictEqual([{ initialValue: true, message: 'Apply this migration?' }]);
		expect(outros()).toContain('Now using Yarn 4.18.0 (node-modules linker).');
	});

	it('honours Plug’n’Play when the user picks it', async () => {
		pretendTty();
		await writeNpmProject(workspace, NPM_DECLARED);
		queueSelect('pnp');
		queueConfirm(true);

		await expect(run(['migrate', '--yarn-version', TARGET_YARN_VERSION, workspace.dir])).resolves.toBe(0);
		expect(await workspace.read('.yarnrc.yml')).toContain('nodeLinker: pnp');
		expect(outros()).toContain('Now using Yarn 4.18.0 (pnp linker).');
	});

	it('asks which manager to convert when several were detected', async () => {
		pretendTty();
		await writeNpmProject(workspace, { stubYarnRelease: true });
		// Written last, so it is the newest lockfile and Yarn is the manager Drillbit suggests.
		await workspace.write('yarn.lock', yarn1LockText());
		queueSelect('npm');
		queueSelect('node-modules');
		queueConfirm(true);

		await expect(run(['migrate', '--yarn-version', TARGET_YARN_VERSION, workspace.dir])).resolves.toBe(0);
		const [managerPrompt, linkerPrompt] = clackState().selects;
		expect(managerPrompt?.message).toBe(
			'Several package managers left traces here. Which one should Drillbit convert?'
		);
		expect(managerPrompt?.options.map((option) => option.value)).toStrictEqual(['yarn', 'npm']);
		expect(linkerPrompt?.message).toBe('How should Yarn lay out node_modules?');
		expect(clackState().notes.at(-1)?.title).toBe('Convert npm to Yarn');
		expect(
			loggedMessagesOf('warn').some((message) => message.includes('Multiple package managers were detected'))
		).toBe(true);
		expect(workspace.exists('package-lock.json')).toBe(false);
	});

	it('assumes the detected manager when --yes is passed on an ambiguous project', async () => {
		// No vendored release here: a dry run never downloads one, so this stays offline
		await writeNpmProject(workspace);
		await workspace.write('yarn.lock', yarn1LockText());
		const before = await workspace.snapshot();

		await expect(run(YES.concat(['--dry-run', workspace.dir]))).resolves.toBe(0);
		expect(clackState().selects).toStrictEqual([]);
		// Yarn was suggested, so this is a Yarn 1 upgrade and npm's lockfile is only reported
		expect(clackState().notes.at(-1)?.title).toBe('Upgrade Yarn 1 to Yarn');
		const warnings = loggedMessagesOf('warn');
		expect(warnings.some((message) => message.includes('Multiple package managers were detected'))).toBe(true);
		expect(
			warnings.some((message) => message.includes('package-lock.json') && message.includes('left in place'))
		).toBe(true);
		expect(await workspace.snapshot()).toStrictEqual(before);
	});

	it('upgrades Yarn 1.22.12 to the latest Yarn', async () => {
		await writeYarn1Project(workspace, { vendorYarn1Release: true });
		await writeStubYarnRelease(workspace);
		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(0);

		expect(workspace.exists('.yarnrc')).toBe(false);
		expect(workspace.exists('.yarn/releases/yarn-1.22.12.cjs')).toBe(false);
		expect(await workspace.read('.yarnrc.yml')).toContain(
			`yarnPath: .yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs`
		);
		expect(outros()).toContain(`Now using Yarn ${TARGET_YARN_VERSION} (node-modules linker).`);
	});

	it('stops before touching anything when the plan is declined', async () => {
		pretendTty();
		await writeNpmProject(workspace, NPM_DECLARED);
		const before = await workspace.snapshot();
		queueSelect('node-modules');
		queueConfirm(false);

		await expect(run(['migrate', '--yarn-version', TARGET_YARN_VERSION, workspace.dir])).resolves.toBe(0);
		expect(outros()).toBe('Nothing was changed.');
		expect(await workspace.snapshot()).toStrictEqual(before);
	});

	it('reports cancellation with exit code 130', async () => {
		pretendTty();
		await writeNpmProject(workspace, NPM_DECLARED);
		const before = await workspace.snapshot();
		queueSelect('node-modules');
		queueConfirm(CLACK_CANCEL);

		await expect(run(['migrate', '--yarn-version', TARGET_YARN_VERSION, workspace.dir])).resolves.toBe(130);
		expect(clackState().cancels).toStrictEqual(['Cancelled — nothing was changed.']);
		expect(await workspace.snapshot()).toStrictEqual(before);
	});

	it('skips the install step with --no-install', async () => {
		await writeNpmProject(workspace, NPM_DECLARED);
		await expect(run(YES.concat(['--no-install', workspace.dir]))).resolves.toBe(0);

		expect(outros()).toContain('Dependencies were not installed (--no-install).');
		expect(outros()).toContain(`Run it later with: node .yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs install`);
		expect(await readStubLog(workspace)).toStrictEqual([]);
		expect(workspace.exists('node_modules')).toBe(false);
		expect(workspace.exists('yarn.lock')).toBe(false);
	});

	it('writes nothing during a dry run', async () => {
		await writeNpmProject(workspace, NPM_DECLARED);
		const before = await workspace.snapshot();
		await expect(run(YES.concat(['--dry-run', workspace.dir]))).resolves.toBe(0);

		expect(outros()).toContain('Dry run: no files were written.');
		expect(await readStubLog(workspace)).toStrictEqual([]);
		expect(await workspace.snapshot()).toStrictEqual(before);
	});
});

describe('run() when the project is already on the target', () => {
	async function writeBerryProject(): Promise<void> {
		await workspace.write(
			'package.json',
			packageJsonText('berry', { 'left-pad': '^1.3.0' }, { packageManager: `yarn@${TARGET_YARN_VERSION}` })
		);
		await workspace.write(
			'.yarnrc.yml',
			`nodeLinker: node-modules\nyarnPath: .yarn/releases/yarn-${TARGET_YARN_VERSION}.cjs\n`
		);
		await writeStubYarnRelease(workspace);
	}

	it('short-circuits instead of re-running the migration', async () => {
		await writeBerryProject();
		const before = await workspace.snapshot();

		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(0);
		expect(outros()).toContain(
			`already uses Yarn ${TARGET_YARN_VERSION} with the node-modules linker — nothing to convert.`
		);
		expect(await workspace.snapshot()).toStrictEqual(before);
	});

	it('re-runs everything with --force', async () => {
		await writeBerryProject();
		await expect(run(YES.concat(['--force', workspace.dir]))).resolves.toBe(0);

		expect(outros()).toContain(`Now using Yarn ${TARGET_YARN_VERSION} (node-modules linker).`);
		expect(await readStubLog(workspace)).toStrictEqual([
			{ args: ['install'], cwd: workspace.dir, version: TARGET_YARN_VERSION },
		]);
	});
});

describe('run() update check', () => {
	const NPM_LATEST = 'https://registry.npmjs.org/drillbit/latest';

	// The suite switches the check off globally, so these tests turn it back on and stub the network.
	const enableUpdateCheck = (): void => {
		delete process.env.DRILLBIT_NO_UPDATE_CHECK;
	};

	const outOfDateMessages = (): string[] =>
		loggedMessagesOf('warn').filter((message) => message.includes('out of date'));

	function stubNpm(version: string): void {
		vi.stubGlobal('fetch', async (url: string) => {
			if (url !== NPM_LATEST) throw new Error(`Unexpected request to ${url}`);
			return new Response(JSON.stringify({ version }), { status: 200 });
		});
	}

	afterEach(() => {
		process.env.DRILLBIT_NO_UPDATE_CHECK = '1';
		vi.unstubAllGlobals();
	});

	it('warns when a newer release is published', async () => {
		enableUpdateCheck();
		stubNpm('9.9.9');
		await writeNpmProject(workspace, NPM_DECLARED);

		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(0);

		expect(outOfDateMessages()).toStrictEqual([
			`Drillbit is out of date! We recommend updating drillbit to its latest release from whichever method you installed drillbit! (${readCliVersion()} -> 9.9.9)`,
		]);
	});

	it('stays quiet when the published release is the one already running', async () => {
		enableUpdateCheck();
		stubNpm(readCliVersion());
		await writeNpmProject(workspace, NPM_DECLARED);

		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(0);

		expect(outOfDateMessages()).toStrictEqual([]);
	});

	it('never asks with --dev', async () => {
		enableUpdateCheck();
		const asked: string[] = [];
		vi.stubGlobal('fetch', async (url: string) => {
			asked.push(url);
			return new Response('{}', { status: 200 });
		});
		await writeNpmProject(workspace, NPM_DECLARED);

		await expect(run(YES.concat([workspace.dir, '--dev']))).resolves.toBe(0);

		expect(asked).toStrictEqual([]);
	});

	it('stays quiet when neither release feed answers', async () => {
		enableUpdateCheck();
		vi.stubGlobal('fetch', async () => {
			throw new Error('offline');
		});
		await writeNpmProject(workspace, NPM_DECLARED);

		await expect(run(YES.concat([workspace.dir]))).resolves.toBe(0);

		expect(outOfDateMessages()).toStrictEqual([]);
	});
});
