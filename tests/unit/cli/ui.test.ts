import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plain } from '../../helpers/ansi.ts';
import { clackState, CLACK_CANCEL, queueConfirm, queueSelect, resetClackState } from '../../helpers/clack-state.ts';
import { createContext, lockfile, packageLock, snapshot } from '../../helpers/context.ts';
import { planMigration, type MigrationPlan } from '../../../src/core/migrations.ts';
import type { DetectedManager, Detection, MigrationContext } from '../../../src/core/types.ts';
import * as ui from '../../../src/cli/ui.ts';

vi.mock('@clack/prompts', async () => await import('../../helpers/clack-mock.ts'));

const NPM_MANAGER: DetectedManager = {
	confidence: 'medium',
	evidence: ['package-lock.json (npm 9 or newer)'],
	flavor: null,
	manager: 'npm',
	version: null,
	versionRange: '9 or newer (lockfileVersion 3)',
};

const YARN_RIVAL: DetectedManager = {
	confidence: 'medium',
	evidence: ['yarn.lock'],
	flavor: 'berry',
	manager: 'yarn',
	version: '4.18.0',
	versionRange: null,
};

function npmDetection(): Detection {
	return {
		ambiguous: false,
		lockfiles: [lockfile('npm', 'package-lock.json', 1)],
		primary: NPM_MANAGER,
		rivals: [],
		warnings: [],
	};
}

function npmContext(overrides: Parameters<typeof createContext>[1] = {}): MigrationContext {
	return createContext(
		snapshot({
			lockfiles: [lockfile('npm', 'package-lock.json', 1)],
			packageLock: packageLock(3, 1),
		}),
		overrides
	);
}

function singleStepPlan(step: MigrationPlan['steps'][number]): MigrationPlan {
	return { description: 'demo', steps: [step], title: 'Demo', warnings: [] };
}

beforeEach(() => {
	resetClackState();
});

describe('showDetection', () => {
	it('summarises the detected manager with its evidence', () => {
		ui.showDetection({ ...npmDetection(), rivals: [YARN_RIVAL] }, 'c:/projects/demo');

		const note = clackState().notes[0];
		const body = plain(note?.body);
		expect(note?.title).toBe('Inspected demo');
		expect(body).toContain('npm 9 or newer (lockfileVersion 3)');
		expect(body).toContain('Evidence');
		expect(body).toContain('package-lock.json (npm 9 or newer)');
		expect(body).toContain('Also present');
		expect(body).toContain('yarn (berry) 4.18.0');
	});

	it('falls back to the full path when the directory has no base name', () => {
		ui.showDetection(npmDetection(), 'C:/');
		expect(clackState().notes[0]?.title).toBe('Inspected C:/');
	});

	it('says so when nothing was detected', () => {
		ui.showDetection({ ambiguous: false, lockfiles: [], primary: null, rivals: [], warnings: [] }, 'demo');
		expect(clackState().notes[0]?.body).toContain('No package manager detected.');
	});
});

describe('showPlan', () => {
	it('lists the target and every step', () => {
		const context = npmContext();
		const plan = planMigration(context);
		ui.showPlan(plan, context);

		const note = clackState().notes[0];
		const body = plain(note?.body);
		expect(note?.title).toBe('Convert npm to Yarn');
		expect(body).toContain(plan.description);
		expect(body).toContain('Target: Yarn 4.18.0 (node-modules linker)');
		expect(body).toMatch(/1\. Download the Yarn 4\.18\.0 release/);
		for (const step of plan.steps) expect(body).toContain(step.title);
		expect(body).not.toContain('Dry run');
		expect(body).not.toContain('--no-install');
	});

	it('announces a dry run and a skipped install', () => {
		const context = npmContext({ dryRun: true, install: false });
		ui.showPlan(planMigration(context), context);
		const body = plain(clackState().notes[0]?.body);
		expect(body).toContain('Dry run: nothing will be written.');
		expect(body).toContain('--no-install: the install step will be skipped.');
	});
});

describe('runPlan', () => {
	it('shows a spinner per step and reports the details', async () => {
		const plan: MigrationPlan = {
			description: 'demo',
			steps: [
				{ id: 'a', run: async () => ({ details: ['did a'] }), title: 'Step A' },
				{ id: 'b', run: async () => undefined, title: 'Step B' },
			],
			title: 'Demo',
			warnings: [],
		};

		await ui.runPlan(plan, npmContext());

		const spinners = clackState().spinners;
		expect(spinners).toHaveLength(2);
		expect(spinners[0]?.starts).toStrictEqual(['Step A']);
		expect(plain(spinners[0]?.stops[0])).toBe('Step A done');
		expect(plain(spinners[1]?.stops[0])).toBe('Step B done');
		expect(clackState().logs.map((entry) => entry.message)).toContain('did a');
	});

	it('lets live steps write straight to the terminal instead of hiding them behind a spinner', async () => {
		const plan = singleStepPlan({
			id: 'live',
			live: true,
			run: async () => ({ details: ['installed'] }),
			title: 'Install',
		});

		await ui.runPlan(plan, npmContext());

		expect(clackState().spinners).toHaveLength(0);
		expect(clackState().logs).toStrictEqual([
			{ kind: 'step', message: 'Install' },
			{ kind: 'message', message: 'installed' },
		]);
	});

	it('stops the spinner and rethrows when a step fails', async () => {
		const failure = new Error('boom');
		const plan = singleStepPlan({
			id: 'a',
			run: async () => {
				throw failure;
			},
			title: 'Step A',
		});

		await expect(ui.runPlan(plan, npmContext())).rejects.toBe(failure);
		expect(plain(clackState().spinners[0]?.stops[0])).toBe('Step A failed');
	});
});

describe('task', () => {
	it('wraps an action in a spinner', async () => {
		await expect(ui.task('Resolving', async () => 42)).resolves.toBe(42);
		expect(clackState().spinners[0]?.starts).toStrictEqual(['Resolving']);
		expect(plain(clackState().spinners[0]?.stops[0])).toBe('Resolving done');
	});

	it('reports a failed action', async () => {
		await expect(
			ui.task('Resolving', async () => {
				throw new Error('offline');
			})
		).rejects.toThrow('offline');
		expect(plain(clackState().spinners[0]?.stops[0])).toBe('Resolving failed');
	});
});

describe('prompts', () => {
	it('returns the chosen manager', async () => {
		queueSelect('npm');
		await expect(ui.chooseManager([NPM_MANAGER, YARN_RIVAL])).resolves.toBe('npm');
		expect(clackState().selects[0]?.options.map((option) => option.value)).toStrictEqual(['npm', 'yarn']);
		expect(clackState().selects[0]?.options.map((option) => option.label)).toStrictEqual([
			'npm 9 or newer (lockfileVersion 3)',
			'yarn (berry) 4.18.0',
		]);
	});

	it('returns null when the manager prompt is cancelled', async () => {
		queueSelect(CLACK_CANCEL);
		await expect(ui.chooseManager([NPM_MANAGER])).resolves.toBeNull();
	});

	it('offers both linkers with the suggested one preselected', async () => {
		queueSelect('pnp');
		await expect(ui.chooseLinker('node-modules')).resolves.toBe('pnp');
		expect(clackState().selects[0]?.options.map((option) => option.label)).toStrictEqual([
			'node-modules',
			"pnp (Plug'n'Play)",
		]);
	});

	it('returns null when the linker prompt is cancelled', async () => {
		queueSelect(CLACK_CANCEL);
		await expect(ui.chooseLinker('pnp')).resolves.toBeNull();
	});

	it('asks to apply the migration, or to walk through a dry run', async () => {
		queueConfirm(true);
		await expect(ui.confirmPlan(npmContext())).resolves.toBe(true);
		expect(clackState().confirms[0]?.message).toBe('Apply this migration?');

		queueConfirm(false);
		await expect(ui.confirmPlan(npmContext({ dryRun: true }))).resolves.toBe(false);
		expect(clackState().confirms[1]?.message).toBe('Walk through this migration?');
	});

	it('returns null when the confirmation is cancelled', async () => {
		queueConfirm(CLACK_CANCEL);
		await expect(ui.confirmPlan(npmContext())).resolves.toBeNull();
	});
});

describe('reporter and messages', () => {
	it('routes reporter calls onto the matching log level', () => {
		const reporter = ui.createCliReporter();
		reporter.info('info line');
		reporter.success('success line');
		reporter.warn('warn line');

		expect(clackState().logs).toStrictEqual([
			{ kind: 'info', message: 'info line' },
			{ kind: 'success', message: 'success line' },
			{ kind: 'warn', message: 'warn line' },
		]);
	});

	it('logs each warning separately', () => {
		ui.showWarnings(['first', 'second']);
		expect(clackState().logs.map((entry) => entry.message)).toStrictEqual(['first', 'second']);
	});

	it('brackets the run with the intro and outro', () => {
		ui.showIntro('0.1.0');
		ui.showOutro('Now using Yarn 4.18.0.');
		expect(clackState().logs[0]?.kind).toBe('intro');
		expect(plain(clackState().logs[0]?.message)).toContain('Drillbit v0.1.0');
		expect(clackState().outros).toStrictEqual(['Now using Yarn 4.18.0.']);
	});

	it('reports errors and cancellations', () => {
		ui.showError('something broke');
		ui.showWarning('be careful');
		ui.showCancelled();
		expect(clackState().logs).toStrictEqual([
			{ kind: 'error', message: 'something broke' },
			{ kind: 'warn', message: 'be careful' },
		]);
		expect(clackState().cancels).toStrictEqual(['Cancelled — nothing was changed.']);
	});
});
