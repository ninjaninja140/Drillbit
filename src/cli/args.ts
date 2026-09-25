import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { isJsonObject, type LinkerId } from '../core/types.ts';
import { isYarnBerryVersion } from '../core/yarn.ts';

export type CommandName = 'help' | 'migrate';

const COMMANDS: CommandName[] = ['help', 'migrate'];

const OPTIONS_HELP = `Options
  -C, --cwd <dir>         Project directory (default: the current directory)
  -y, --yes               Accept the suggested answers and skip confirmations
      --dry-run           Report what would change without touching the project
      --linker <name>     Yarn linker to use: node-modules (default) or pnp
      --no-install        Skip the final \`yarn install\`
      --yarn-version <v>  Yarn version to switch to (default: the latest release)
      --force             Run even when the project already uses the target setup
      --dev               Skip the production-only checks, such as the update check
  -h, --help              Show this help
  -v, --version           Show the Drillbit version
`;

export const HELP = `Drillbit — move a project from one package manager to another.

Usage
  drillbit <command> [directory] [options]

Commands
  migrate [directory]  Convert the project to Yarn
  help [command]       Show this help, or the help for a single command

${OPTIONS_HELP}`;

export const MIGRATE_HELP = `Drillbit migrate — convert a project to Yarn.

Usage
  drillbit migrate [directory] [options]

${OPTIONS_HELP}
Supported conversions (v0.1)
  npm      → Yarn (latest)
  Yarn 1.x → Yarn (latest)
`;

export function helpText(command: CommandName | null): string {
	return command === 'migrate' ? MIGRATE_HELP : HELP;
}

export interface CliOptions {
	// null when no command was given, which is a usage error outside of `--help`/`--version`.
	command: CommandName | null;
	cwd: string;
	// Skips the production-only checks.
	dev: boolean;
	dryRun: boolean;
	force: boolean;
	help: boolean;
	// Command a `drillbit help <command>` invocation asked about.
	helpTarget: CommandName | null;
	install: boolean;
	// null when the user did not choose a linker.
	linker: LinkerId | null;
	version: boolean;
	yes: boolean;
	yarnVersion: string | null;
}

export interface ParsedArgs {
	error: string | null;
	options: CliOptions;
}

export function readCliVersion(): string {
	try {
		const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
		const parsed: unknown = JSON.parse(raw);
		if (isJsonObject(parsed) && typeof parsed.version === 'string') return parsed.version;
	} catch {
		// the package manifest is not reachable (e.g. a bundled build); fall through
	}
	return '0.0.0';
}

function asCommand(value: string): CommandName | null {
	return COMMANDS.find((command) => command === value) ?? null;
}

function unknownCommand(value: string): ParsedArgs {
	return {
		error: `Unknown command "${value}". Run \`drillbit help\` to see the available commands.`,
		options: fallbackOptions(),
	};
}

function fallbackOptions(): CliOptions {
	return {
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
	};
}

export function parseCliArgs(argv: string[]): ParsedArgs {
	const fallback = fallbackOptions();

	let values: Record<string, unknown>;
	let positionals: string[];
	try {
		const parsed = parseArgs({
			allowPositionals: true,
			args: argv,
			options: {
				cwd: { short: 'C', type: 'string' },
				dev: { default: false, type: 'boolean' },
				'dry-run': { default: false, type: 'boolean' },
				force: { default: false, type: 'boolean' },
				help: { default: false, short: 'h', type: 'boolean' },
				linker: { type: 'string' },
				'no-install': { default: false, type: 'boolean' },
				version: { default: false, short: 'v', type: 'boolean' },
				'yarn-version': { type: 'string' },
				yes: { default: false, short: 'y', type: 'boolean' },
			},
			strict: true,
		});
		values = parsed.values as Record<string, unknown>;
		positionals = parsed.positionals;
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), options: fallback };
	}

	const [rawCommand, rawArgument, ...extra] = positionals;
	const command = rawCommand === undefined ? null : asCommand(rawCommand);
	if (rawCommand !== undefined && command === null) return unknownCommand(rawCommand);
	if (extra.length > 0) {
		const expected = command === 'help' ? 'command' : 'directory';
		return {
			error: `Expected at most one ${expected} after \`${rawCommand}\`, got ${extra.length + 1}.`,
			options: fallback,
		};
	}

	let helpTarget: CommandName | null = null;
	if (command === 'help' && rawArgument !== undefined) {
		helpTarget = asCommand(rawArgument);
		if (helpTarget === null) return unknownCommand(rawArgument);
	}

	const linker = values.linker;
	if (linker !== undefined && linker !== 'node-modules' && linker !== 'pnp') {
		return {
			error: `--linker must be either "node-modules" or "pnp" (got "${String(linker)}").`,
			options: fallback,
		};
	}

	const yarnVersion = values['yarn-version'];
	if (yarnVersion !== undefined && !isYarnBerryVersion(String(yarnVersion))) {
		return {
			error: `--yarn-version must be a Yarn 2+ release such as "4.18.0" (got "${String(yarnVersion)}").`,
			options: fallback,
		};
	}

	const directory = command === 'migrate' ? rawArgument : undefined;

	return {
		error: null,
		options: {
			command,
			cwd: (values.cwd as string | undefined) ?? directory ?? process.cwd(),
			dev: values.dev === true,
			dryRun: values['dry-run'] === true,
			force: values.force === true,
			help: values.help === true,
			helpTarget,
			install: values['no-install'] !== true,
			linker: (linker as LinkerId | undefined) ?? null,
			version: values.version === true,
			yes: values.yes === true,
			yarnVersion: yarnVersion === undefined ? null : String(yarnVersion),
		},
	};
}
