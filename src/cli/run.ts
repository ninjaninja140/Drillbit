import { join, resolve } from 'node:path';
import { detectFromSnapshot } from '../core/detect.ts';
import { exists } from '../core/fsx.ts';
import { planMigration, type MigrationPlan } from '../core/migrations.ts';
import { readProject } from '../core/project.ts';
import type {
	Detection,
	LinkerId,
	ManagerId,
	MigrationContext,
	MigrationTarget,
	ProjectSnapshot,
} from '../core/types.ts';
import { findUpdate, outOfDateMessage } from '../core/update.ts';
import { resolveLatestYarnVersion } from '../core/yarn.ts';
import { readLinker } from '../core/yarnrc.ts';
import { HELP, helpText, parseCliArgs, readCliVersion } from './args.ts';
import * as ui from './ui.ts';

const MINIMUM_NODE_MAJOR = 22;
const DEFAULT_LINKER: LinkerId = 'node-modules';
// Nothing was changed because the run was stopped on purpose.
const EXIT_CANCELLED = 130;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function usageError(message: string): number {
	process.stderr.write(`${HELP}\n`);
	ui.showError(message);
	return EXIT_USAGE;
}

function nodeMajor(): number {
	return Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
}

function selectPrimary(detection: Detection, manager: ManagerId): Detection {
	const all = detection.primary === null ? detection.rivals : [detection.primary, ...detection.rivals];
	const match = all.find((candidate) => candidate.manager === manager);
	if (match === undefined) return detection;
	return {
		...detection,
		ambiguous: false,
		primary: match,
		rivals: all.filter((candidate) => candidate.manager !== manager),
	};
}

async function resolveTargetVersion(yarnVersion: string | null): Promise<string> {
	if (yarnVersion !== null) return yarnVersion;
	const resolved = await ui.task('Looking up the latest Yarn release', resolveLatestYarnVersion);
	if (resolved.source === 'fallback') {
		ui.showWarning(`The npm registry could not be reached; using Yarn ${resolved.version}.`);
	}
	return resolved.version;
}

// The production-only checks: `--dev`, or DRILLBIT_NO_UPDATE_CHECK for scripts and the test suite,
// keeps them from running.
async function warnAboutUpdates(current: string): Promise<void> {
	if (process.env.DRILLBIT_NO_UPDATE_CHECK !== undefined) return;
	const notice = await findUpdate(current);
	if (notice !== null) ui.showWarning(outOfDateMessage(notice));
}

// The layout the project already uses, or null when it never chose one.
function existingLinker(project: ProjectSnapshot): LinkerId | null {
	const declared = readLinker(project.yarnrcYml);
	if (declared !== null) return declared;
	// A Berry project without an explicit nodeLinker is on Yarn's own default.
	return project.yarnrcYml === null ? null : DEFAULT_LINKER;
}

async function resolveLinker(
	project: ProjectSnapshot,
	options: { linker: LinkerId | null; yes: boolean }
): Promise<LinkerId | null> {
	if (options.linker !== null) return options.linker;
	const current = existingLinker(project);
	// Re-pinning a Berry project keeps its layout; only new Yarn projects get asked.
	if (options.yes || current !== null) return current ?? DEFAULT_LINKER;
	const chosen = await ui.chooseLinker(DEFAULT_LINKER);
	return chosen;
}

function alreadyOnTarget(
	primary: Detection['primary'],
	target: MigrationTarget,
	currentLinker: LinkerId | null
): boolean {
	if (primary === null || primary.manager !== 'yarn') return false;
	return primary.version === target.version && (currentLinker ?? DEFAULT_LINKER) === target.linker;
}

function isInteractive(): boolean {
	return process.stdin.isTTY === true;
}

export async function run(argv: string[]): Promise<number> {
	const { options, error } = parseCliArgs(argv);
	if (error !== null) return usageError(error);
	if (options.help) {
		process.stdout.write(helpText(options.command));
		return 0;
	}
	if (options.version) {
		process.stdout.write(`${readCliVersion()}\n`);
		return 0;
	}
	if (options.command === 'help') {
		process.stdout.write(helpText(options.helpTarget));
		return 0;
	}
	if (options.command === null) {
		return usageError(
			'Drillbit needs a command. Run `drillbit help` to list them, or `drillbit migrate` to convert a project.'
		);
	}
	if (nodeMajor() < MINIMUM_NODE_MAJOR) {
		ui.showError(`Drillbit needs Node.js ${MINIMUM_NODE_MAJOR} or newer, but this is ${process.versions.node}.`);
		return EXIT_USAGE;
	}
	if (!options.yes && !isInteractive()) {
		ui.showError(
			'Drillbit asks questions before it touches anything, which needs an interactive terminal. Re-run with --yes to accept the suggested answers instead.'
		);
		return EXIT_USAGE;
	}

	const cliVersion = readCliVersion();
	ui.showIntro(cliVersion);
	if (!options.dev) await warnAboutUpdates(cliVersion);

	const cwd = resolve(options.cwd);
	if (!(await exists(join(cwd, 'package.json')))) {
		ui.showError(`No package.json in ${cwd}. Pass a project directory with --cwd or as the first argument.`);
		return EXIT_ERROR;
	}

	let project: ProjectSnapshot;
	try {
		project = await readProject(cwd);
	} catch (caught) {
		ui.showError(messageOf(caught));
		return EXIT_ERROR;
	}

	let detection = detectFromSnapshot(project);
	ui.showDetection(detection, cwd);
	ui.showWarnings(detection.warnings);

	if (detection.primary === null) {
		ui.showError(
			'Drillbit could not tell which package manager this project uses. Add a "packageManager" field to package.json or a lockfile, then try again.'
		);
		return EXIT_ERROR;
	}

	if (detection.ambiguous && !options.yes) {
		const candidates = [detection.primary, ...detection.rivals];
		const chosen = await ui.chooseManager(candidates);
		if (chosen === null) {
			ui.showCancelled();
			return EXIT_CANCELLED;
		}
		detection = selectPrimary(detection, chosen);
	}

	let version: string;
	try {
		version = await resolveTargetVersion(options.yarnVersion);
	} catch (caught) {
		ui.showError(messageOf(caught));
		return EXIT_ERROR;
	}

	const currentLinker = existingLinker(project);
	const currentTarget: MigrationTarget = { linker: currentLinker ?? DEFAULT_LINKER, manager: 'yarn', version };
	if (alreadyOnTarget(detection.primary, currentTarget, currentLinker) && !options.force) {
		ui.showOutro(
			`${cwd} already uses Yarn ${version} with the ${currentTarget.linker} linker — nothing to convert.`
		);
		return 0;
	}

	let linker: LinkerId | null;
	try {
		linker = await resolveLinker(project, options);
	} catch (caught) {
		ui.showError(messageOf(caught));
		return EXIT_ERROR;
	}
	if (linker === null) {
		ui.showCancelled();
		return EXIT_CANCELLED;
	}

	const target: MigrationTarget = { linker, manager: 'yarn', version };

	const context: MigrationContext = {
		cwd,
		detection,
		dryRun: options.dryRun,
		install: options.install,
		project,
		reporter: ui.createCliReporter(),
		target,
	};

	let plan: MigrationPlan;
	try {
		plan = planMigration(context);
	} catch (caught) {
		ui.showError(messageOf(caught));
		return EXIT_ERROR;
	}

	ui.showPlan(plan, context);
	ui.showWarnings(plan.warnings);

	if (!options.yes) {
		const answer = await ui.confirmPlan(context);
		if (answer === null) {
			ui.showCancelled();
			return EXIT_CANCELLED;
		}
		if (!answer) {
			ui.showOutro('Nothing was changed.');
			return 0;
		}
	}

	try {
		await ui.runPlan(plan, context);
	} catch (caught) {
		ui.showError(
			`${messageOf(caught)}\nThe project may be half-migrated; fix the error above and run Drillbit again.`
		);
		return EXIT_ERROR;
	}

	const notes = options.dryRun
		? ['Dry run: no files were written.']
		: options.install
			? ['Dependencies installed and the lockfile is up to date.']
			: [
					'Dependencies were not installed (--no-install).',
					`Run it later with: node .yarn/releases/yarn-${version}.cjs install`,
				];
	ui.showOutro([`Now using Yarn ${version} (${linker} linker).`, ...notes].join('\n'));
	return 0;
}
