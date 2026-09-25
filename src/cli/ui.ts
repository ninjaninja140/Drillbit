import { basename } from 'node:path';
import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { formatManager } from '../core/detect.ts';
import type { MigrationPlan } from '../core/migrations.ts';
import type { DetectedManager, Detection, LinkerId, ManagerId, MigrationContext, Reporter } from '../core/types.ts';

export function showIntro(version: string): void {
	intro(`Drillbit ${pc.dim(`v${version}`)} — switch package managers without breaking the tree`);
}

export function showDetection(detection: Detection, cwd: string): void {
	const primary = detection.primary;
	const lines: string[] = [];
	if (primary === null) {
		lines.push(pc.yellow('No package manager detected.'));
	} else {
		lines.push(`${pc.bold(formatManager(primary))}  ${pc.dim(`(${primary.confidence} confidence)`)}`);
		lines.push('', pc.dim('Evidence'));
		lines.push(...primary.evidence.map((entry) => `  • ${entry}`));
	}
	if (detection.rivals.length > 0) {
		lines.push('', pc.dim('Also present'));
		lines.push(
			...detection.rivals.map((rival) => `  • ${formatManager(rival)} — ${rival.evidence[0] ?? 'unknown'}`)
		);
	}
	note(lines.join('\n'), `Inspected ${basename(cwd) || cwd}`);
}

export function showWarnings(warnings: string[]): void {
	for (const warning of warnings) log.warn(warning);
}

export async function chooseManager(candidates: DetectedManager[]): Promise<ManagerId | null> {
	const choice = await select<ManagerId>({
		message: 'Several package managers left traces here. Which one should Drillbit convert?',
		options: candidates.map((candidate) => ({
			hint: candidate.evidence[0] ?? '',
			label: formatManager(candidate),
			value: candidate.manager,
		})),
	});
	if (isCancel(choice)) return null;
	return choice;
}

export async function chooseLinker(defaultLinker: LinkerId): Promise<LinkerId | null> {
	const choice = await select<LinkerId>({
		initialValue: defaultLinker,
		message: 'How should Yarn lay out node_modules?',
		options: [
			{ hint: 'standard layout, works with every tool', label: 'node-modules', value: 'node-modules' },
			{ hint: 'strict, no node_modules folder', label: "pnp (Plug'n'Play)", value: 'pnp' },
		],
	});
	if (isCancel(choice)) return null;
	return choice;
}

export function showPlan(plan: MigrationPlan, context: MigrationContext): void {
	const lines = [
		plan.description,
		'',
		pc.dim(`Target: Yarn ${context.target.version} (${context.target.linker} linker)`),
	];
	if (context.dryRun) lines.push(pc.yellow('Dry run: nothing will be written.'));
	if (!context.install) lines.push(pc.yellow('--no-install: the install step will be skipped.'));
	lines.push('', pc.dim('Steps'));
	lines.push(...plan.steps.map((step, index) => `${pc.dim(`${index + 1}.`)} ${step.title}`));
	note(lines.join('\n'), plan.title);
}

export async function confirmPlan(context: MigrationContext): Promise<boolean | null> {
	const answer = await confirm({
		initialValue: true,
		message: context.dryRun ? 'Walk through this migration?' : 'Apply this migration?',
	});
	if (isCancel(answer)) return null;
	return answer;
}

export async function runPlan(plan: MigrationPlan, context: MigrationContext): Promise<void> {
	for (const step of plan.steps) {
		if (step.live === true) {
			log.step(step.title);
			const result = await step.run(context);
			for (const detail of result?.details ?? []) log.message(detail);
			continue;
		}
		const progress = spinner();
		progress.start(step.title);
		try {
			const result = await step.run(context);
			progress.stop(`${step.title} ${pc.green('done')}`);
			for (const detail of result?.details ?? []) log.message(detail);
		} catch (error) {
			progress.stop(`${step.title} ${pc.red('failed')}`);
			throw error;
		}
	}
}

export function showWarning(message: string): void {
	log.warn(message);
}

export function showError(message: string): void {
	log.error(message);
}

export function showOutro(message: string): void {
	outro(message);
}

// Runs a short background task behind a spinner.
export async function task<T>(title: string, action: () => Promise<T>): Promise<T> {
	const progress = spinner();
	progress.start(title);
	try {
		const result = await action();
		progress.stop(`${title} ${pc.green('done')}`);
		return result;
	} catch (error) {
		progress.stop(`${title} ${pc.red('failed')}`);
		throw error;
	}
}

export function showCancelled(): void {
	cancel('Cancelled — nothing was changed.');
}

export function createCliReporter(): Reporter {
	return {
		info: (message) => log.info(message),
		success: (message) => log.success(message),
		warn: (message) => log.warn(message),
	};
}
