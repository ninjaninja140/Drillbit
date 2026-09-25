import { detectFromSnapshot } from '../../src/core/detect.ts';
import { planMigration, type MigrationPlan } from '../../src/core/migrations.ts';
import { readProject } from '../../src/core/project.ts';
import { createCollectingReporter, type CollectingReporter } from '../../src/core/report.ts';
import type { LinkerId, MigrationContext } from '../../src/core/types.ts';
import { TARGET_YARN_VERSION } from './context.ts';
import type { Workspace } from './workspace.ts';

export interface RunMigrationOptions {
	dryRun?: boolean;
	// Defaults to true, matching the CLI; set to false to exercise `--no-install`.
	install?: boolean;
	linker?: LinkerId;
	version?: string;
}

export interface RunMigrationResult {
	context: MigrationContext;
	// Step id → the details that step reported.
	details: Map<string, string[]>;
	plan: MigrationPlan;
	reporter: CollectingReporter;
	stepIds: string[];
}

// Reads a project from disk and runs the real migration plan against it, step by step: the
// integration tests therefore drive the same code path the CLI does, only without the prompts.
export async function runMigration(
	workspace: Workspace,
	options: RunMigrationOptions = {}
): Promise<RunMigrationResult> {
	const reporter = createCollectingReporter();
	const project = await readProject(workspace.dir);
	const context: MigrationContext = {
		cwd: workspace.dir,
		detection: detectFromSnapshot(project),
		dryRun: options.dryRun ?? false,
		install: options.install ?? true,
		project,
		reporter,
		target: {
			linker: options.linker ?? 'node-modules',
			manager: 'yarn',
			version: options.version ?? TARGET_YARN_VERSION,
		},
	};
	const plan = planMigration(context);
	const details = new Map<string, string[]>();
	for (const step of plan.steps) {
		const result = await step.run(context);
		details.set(step.id, result?.details ?? []);
	}
	return { context, details, plan, reporter, stepIds: plan.steps.map((step) => step.id) };
}
