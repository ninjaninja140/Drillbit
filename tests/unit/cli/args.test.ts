import { describe, expect, it } from 'vitest';
import { HELP, MIGRATE_HELP, helpText, parseCliArgs, readCliVersion } from '../../../src/cli/args.ts';

const UNKNOWN = (command: string): string =>
	`Unknown command "${command}". Run \`drillbit help\` to see the available commands.`;

describe('parseCliArgs', () => {
	it('reports no command and the defaults when nothing is passed', () => {
		const { error, options } = parseCliArgs([]);
		expect(error).toBeNull();
		expect(options).toEqual({
			command: null,
			cwd: process.cwd(),
			dev: false,
			dryRun: false,
			force: false,
			help: false,
			helpTarget: null,
			install: true,
			linker: null,
			version: false,
			yes: false,
			yarnVersion: null,
		});
	});

	it('reads the migrate command and the directory that follows it', () => {
		const { error, options } = parseCliArgs(['migrate', 'C:/somewhere/else']);
		expect(error).toBeNull();
		expect(options.command).toBe('migrate');
		expect(options.cwd).toBe('C:/somewhere/else');
	});

	it('prefers --cwd and its short form over the positional argument', () => {
		expect(parseCliArgs(['migrate', '--cwd', 'C:/a', 'C:/b']).options.cwd).toBe('C:/a');
		expect(parseCliArgs(['migrate', '-C', 'C:/a']).options.cwd).toBe('C:/a');
	});

	it('reads the command a help invocation asks about', () => {
		expect(parseCliArgs(['help']).options).toMatchObject({ command: 'help', helpTarget: null });
		expect(parseCliArgs(['help', 'migrate']).options.helpTarget).toBe('migrate');
		expect(parseCliArgs(['help', 'nope']).error).toBe(UNKNOWN('nope'));
	});

	it('rejects a command it does not know', () => {
		expect(parseCliArgs(['migrte']).error).toBe(UNKNOWN('migrte'));
		expect(parseCliArgs(['migrate', 'extra', 'args']).error).toBe(
			'Expected at most one directory after `migrate`, got 2.'
		);
		expect(parseCliArgs(['help', 'migrate', 'extra']).error).toBe(
			'Expected at most one command after `help`, got 2.'
		);
	});

	it('reads the short and long forms of the boolean flags', () => {
		expect(parseCliArgs(['migrate', '-y']).options.yes).toBe(true);
		expect(parseCliArgs(['migrate', '--yes']).options.yes).toBe(true);
		expect(parseCliArgs(['migrate', '--force']).options.force).toBe(true);
		expect(parseCliArgs(['migrate', '--dry-run']).options.dryRun).toBe(true);
		expect(parseCliArgs(['migrate', '--no-install']).options.install).toBe(false);
		expect(parseCliArgs(['-h']).options.help).toBe(true);
		expect(parseCliArgs(['-v']).options.version).toBe(true);
	});

	it('accepts --dev as a trailing argument', () => {
		const { error, options } = parseCliArgs(['migrate', 'C:/project', '--yes', '--dev']);
		expect(error).toBeNull();
		expect(options.dev).toBe(true);
		expect(options.yes).toBe(true);
		expect(options.cwd).toBe('C:/project');
	});

	it('leaves --dev off unless it is passed', () => {
		expect(parseCliArgs(['migrate', 'C:/project']).options.dev).toBe(false);
	});

	it('accepts both linkers and rejects anything else', () => {
		expect(parseCliArgs(['--linker', 'node-modules']).options.linker).toBe('node-modules');
		expect(parseCliArgs(['--linker', 'pnp']).options.linker).toBe('pnp');
		const { error, options } = parseCliArgs(['--linker', 'pnpm']);
		expect(error).toBe('--linker must be either "node-modules" or "pnp" (got "pnpm").');
		expect(options.linker).toBeNull();
	});

	it('accepts Yarn 2+ versions and rejects Yarn 1', () => {
		expect(parseCliArgs(['--yarn-version', '4.18.0']).options.yarnVersion).toBe('4.18.0');
		expect(parseCliArgs(['--yarn-version', '5.0.0-rc.1']).options.yarnVersion).toBe('5.0.0-rc.1');
		expect(parseCliArgs(['--yarn-version', '1.22.12']).error).toBe(
			'--yarn-version must be a Yarn 2+ release such as "4.18.0" (got "1.22.12").'
		);
		expect(parseCliArgs(['--yarn-version', 'v4']).error).not.toBeNull();
	});

	it('reports unknown flags and missing values', () => {
		expect(parseCliArgs(['--nope']).error).toMatch(/--nope/);
		expect(parseCliArgs(['--linker']).error).not.toBeNull();
	});

	it('rejects more than one directory', () => {
		expect(parseCliArgs(['migrate', 'C:/a', 'C:/b']).error).toBe(
			'Expected at most one directory after `migrate`, got 2.'
		);
	});
});

describe('help text', () => {
	it('documents every command and option', () => {
		for (const entry of [
			'drillbit <command> [directory] [options]',
			'migrate [directory]',
			'help [command]',
			'-C, --cwd',
			'-y, --yes',
			'--dry-run',
			'--linker',
			'--no-install',
			'--yarn-version',
			'--force',
			'--dev',
			'-h, --help',
			'-v, --version',
		]) {
			expect(HELP).toContain(entry);
		}
	});

	it('keeps the conversions on the migrate command', () => {
		expect(MIGRATE_HELP).toContain('drillbit migrate [directory] [options]');
		expect(MIGRATE_HELP).toContain('npm      → Yarn (latest)');
		expect(MIGRATE_HELP).toContain('Yarn 1.x → Yarn (latest)');
	});

	it('picks the text that belongs to a command', () => {
		expect(helpText(null)).toBe(HELP);
		expect(helpText('help')).toBe(HELP);
		expect(helpText('migrate')).toBe(MIGRATE_HELP);
	});
});

describe('readCliVersion', () => {
	it('reads the version out of package.json', () => {
		expect(readCliVersion()).toMatch(/^\d+\.\d+\.\d+/);
	});
});
