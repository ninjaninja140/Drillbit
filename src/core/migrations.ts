import { join } from 'node:path';
import { runNodeScript } from './exec.ts';
import { exists, removePath, withPackageManagerField, writeFileEnsured } from './fsx.ts';
import { planYarnGitignore } from './gitignore.ts';
import type { JsonObject, MigrationContext, MigrationStep, StepResult } from './types.ts';
import { downloadYarnRelease, yarnReleasePath, yarnReleaseRelativePath, yarnReleaseUrl } from './yarn.ts';
import { migrateLegacyYarnrc, migrateNpmrc, mergeYarnrcYml } from './yarnrc.ts';

export type MigrationSource = 'npm' | 'yarn-berry' | 'yarn-classic';

// Files a previous install left behind; they cannot be reused by another package manager.
const INSTALL_ARTIFACTS = [
	'node_modules',
	'.pnp.cjs',
	'.pnp.loader.mjs',
	'.yarn/build-state.yml',
	'.yarn/install-state.gz',
	'.yarn/unplugged',
];

export interface MigrationPlan {
	description: string;
	steps: MigrationStep[];
	title: string;
	warnings: string[];
}

function formatBytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function quote(values: string[]): string {
	return values.map((value) => `\`${value}\``).join(', ');
}

function formatValue(value: unknown): string {
	return typeof value === 'string' ? `"${value}"` : String(value);
}

function formatEntries(settings: JsonObject): string[] {
	return Object.entries(settings).map(([key, value]) => `${key}: ${formatValue(value)}`);
}

function removeFilesStep(context: MigrationContext, id: string, title: string, files: string[]): MigrationStep {
	return {
		id,
		title,
		run: async (): Promise<StepResult> => {
			const removed: string[] = [];
			const planned: string[] = [];
			for (const file of files) {
				if (!(await exists(join(context.cwd, file)))) continue;
				if (context.dryRun) {
					planned.push(file);
					continue;
				}
				await removePath(join(context.cwd, file));
				removed.push(file);
			}
			const details = [
				...removed.map((file) => `Removed ${file}`),
				...planned.map((file) => `Would remove ${file}`),
			];
			return { details: details.length === 0 ? ['Nothing to remove'] : details };
		},
	};
}

function vendorYarnStep(context: MigrationContext): MigrationStep {
	return {
		id: 'vendor-yarn',
		title: `Download the Yarn ${context.target.version} release`,
		run: async (): Promise<StepResult> => {
			const relative = yarnReleaseRelativePath(context.target.version);
			if (await exists(yarnReleasePath(context.cwd, context.target.version))) {
				return { details: [`${relative} is already vendored`] };
			}
			if (context.dryRun) {
				return { details: [`Would download ${yarnReleaseUrl(context.target.version)} into ${relative}`] };
			}
			const download = await downloadYarnRelease(context.cwd, context.target.version);
			return { details: [`Vendored ${relative} (${formatBytes(download.bytes)})`] };
		},
	};
}

function writeYarnrcYmlStep(context: MigrationContext, settings: JsonObject): MigrationStep {
	return {
		id: 'write-yarnrc-yml',
		title: 'Write .yarnrc.yml',
		run: async (): Promise<StepResult> => {
			const updates: JsonObject = {
				nodeLinker: context.target.linker,
				...settings,
				// Set last so a migrated setting can never point somewhere else than the vendored release.
				yarnPath: yarnReleaseRelativePath(context.target.version),
			};
			const keys = Object.keys(updates);
			if (context.dryRun) return { details: [`Would write ${quote(keys)}`] };
			await writeFileEnsured(
				join(context.cwd, '.yarnrc.yml'),
				mergeYarnrcYml(context.project.yarnrcYml, updates)
			);
			const kept = context.project.yarnrcYml === null ? [] : ['existing settings and comments kept'];
			return { details: [`Wrote ${quote(keys)}`, ...kept] };
		},
	};
}

function setPackageManagerFieldStep(context: MigrationContext): MigrationStep {
	return {
		id: 'set-package-manager',
		title: 'Pin the version in package.json',
		run: async (): Promise<StepResult> => {
			const spec = `yarn@${context.target.version}`;
			if (context.project.packageJsonRaw === null) return { details: ['No package.json to update'] };
			if (context.dryRun) return { details: [`Would set "packageManager": "${spec}"`] };
			await writeFileEnsured(
				join(context.cwd, 'package.json'),
				withPackageManagerField(context.project.packageJsonRaw, spec)
			);
			return { details: [`Set "packageManager": "${spec}"`] };
		},
	};
}

function updateGitignoreStep(context: MigrationContext, additions: string[]): MigrationStep {
	return {
		id: 'update-gitignore',
		title: 'Update .gitignore',
		run: async (): Promise<StepResult> => {
			if (context.dryRun) return { details: [`Would add ${quote(additions)}`] };
			const update = planYarnGitignore(context.project.gitignore, context.target.linker);
			if (update.additions.length === 0) return { details: ['Already ignored'] };
			await writeFileEnsured(join(context.cwd, '.gitignore'), update.content);
			return { details: [`Added ${quote(update.additions)}`] };
		},
	};
}

function migrateYarnrcStep(context: MigrationContext, settings: JsonObject): MigrationStep {
	const migration = migrateLegacyYarnrc(context.project.legacyYarnrc);
	return {
		id: 'migrate-yarnrc',
		title: 'Migrate .yarnrc settings',
		run: async (): Promise<StepResult> => {
			const details = [
				...formatEntries(settings).map((entry) => `Mapped ${entry}`),
				...migration.ignored.map((key) => `Dropped \`${key}\` (no longer needed)`),
				...migration.notes,
				...migration.unsupported.map((setting) => `Dropped \`${setting.key}\` (${setting.reason})`),
			];
			if (context.dryRun) return { details };
			await removePath(join(context.cwd, '.yarnrc'));
			return { details: [...details, 'Removed .yarnrc (Yarn 4 ignores it)'] };
		},
	};
}

function migrateNpmrcStep(settings: JsonObject): MigrationStep {
	return {
		id: 'migrate-npmrc',
		title: 'Carry .npmrc settings over',
		run: async (): Promise<StepResult> => ({
			details: formatEntries(settings).map((entry) => `Mapped ${entry}`),
		}),
	};
}

function installStep(context: MigrationContext): MigrationStep {
	return {
		id: 'install',
		live: true,
		title: 'Install dependencies with Yarn',
		run: async (): Promise<StepResult> => {
			if (!context.install) return { details: ['Skipped because --no-install was passed'] };
			if (context.dryRun) return { details: ['Would run `yarn install`'] };
			context.reporter.info(`Running yarn install with .yarn/releases/yarn-${context.target.version}.cjs`);
			const result = await runNodeScript(yarnReleasePath(context.cwd, context.target.version), ['install'], {
				cwd: context.cwd,
				live: true,
			});
			if (result.failed) {
				throw new Error(
					`\`yarn install\` failed with exit code ${result.exitCode}. Fix the reported problems and run Drillbit again, or pass --no-install and run Yarn yourself.`
				);
			}
			return { details: ['Installed dependencies'] };
		},
	};
}

export function planYarn4Migration(context: MigrationContext, source: MigrationSource): MigrationPlan {
	const warnings: string[] = [];
	const steps: MigrationStep[] = [];
	const fromNpm = source === 'npm';
	const fromClassic = source === 'yarn-classic';
	const version = context.target.version;

	steps.push(vendorYarnStep(context));

	const staleReleases = context.project.vendoredYarnReleases
		.filter((file) => file !== `yarn-${version}.cjs`)
		.map((file) => `.yarn/releases/${file}`);
	if (staleReleases.length > 0) {
		steps.push(removeFilesStep(context, 'prune-releases', 'Remove superseded Yarn releases', staleReleases));
	}

	steps.push(
		removeFilesStep(context, 'clean-install-artifacts', 'Remove files from the previous install', INSTALL_ARTIFACTS)
	);

	if (fromNpm) {
		const npmLockfiles = context.detection.lockfiles
			.filter((lockfile) => lockfile.manager === 'npm')
			.map((lockfile) => lockfile.path);
		if (npmLockfiles.length > 0) {
			steps.push(removeFilesStep(context, 'remove-npm-lockfiles', 'Remove npm lockfiles', npmLockfiles));
		}
	}

	// Migrated settings never override the linker or release that Drillbit is pinning.
	const settings: JsonObject = {};
	const npmrc = migrateNpmrc(context.project.npmrc);
	Object.assign(settings, npmrc.settings);
	if (Object.keys(npmrc.settings).length > 0) steps.push(migrateNpmrcStep(npmrc.settings));
	if (npmrc.credentials.length > 0) {
		warnings.push(
			`.npmrc holds registry credentials (${quote(npmrc.credentials)}). Drillbit never copies secrets: add them to .yarnrc.yml as npmRegistries.<registry>.npmAuthToken if the install fails to authenticate.`
		);
	}

	if (fromClassic && context.project.legacyYarnrc !== null) {
		const migration = migrateLegacyYarnrc(context.project.legacyYarnrc);
		Object.assign(settings, migration.settings);
		steps.push(migrateYarnrcStep(context, migration.settings));
		for (const setting of migration.unsupported) {
			warnings.push(`\`${setting.key}\` from .yarnrc was dropped: ${setting.reason}.`);
		}
	}

	steps.push(writeYarnrcYmlStep(context, settings));
	steps.push(setPackageManagerFieldStep(context));

	const gitignore = planYarnGitignore(context.project.gitignore, context.target.linker);
	if (gitignore.additions.length > 0) steps.push(updateGitignoreStep(context, gitignore.additions));

	steps.push(installStep(context));

	for (const lockfile of context.detection.lockfiles) {
		if (fromNpm && lockfile.manager === 'npm') continue;
		if (fromNpm && lockfile.path === 'yarn.lock') {
			warnings.push('yarn.lock already exists; Yarn reuses it as the import source for the new lockfile.');
			continue;
		}
		if (lockfile.manager !== 'yarn') {
			warnings.push(
				`${quote([lockfile.path])} belongs to ${lockfile.manager} and is left in place. Delete it once the migration looks good.`
			);
		}
	}

	const title = fromNpm ? 'Convert npm to Yarn' : fromClassic ? 'Upgrade Yarn 1 to Yarn' : 'Re-pin Yarn';
	const description = fromClassic
		? `Map .yarnrc into .yarnrc.yml, let Yarn convert the v1 yarn.lock in place, and rebuild node_modules with Yarn ${version}.`
		: fromNpm
			? `Drop package-lock.json and node_modules, vendor Yarn ${version}, and generate a fresh yarn.lock.`
			: `Replace the vendored Yarn release with Yarn ${version} and rebuild node_modules.`;

	return { description, steps, title, warnings };
}

export function planMigration(context: MigrationContext): MigrationPlan {
	const primary = context.detection.primary;
	if (primary === null) {
		throw new Error('No package manager was detected, so there is nothing to convert.');
	}
	if (primary.manager === 'npm') return planYarn4Migration(context, 'npm');
	if (primary.manager === 'yarn') {
		return planYarn4Migration(context, primary.flavor === 'berry' ? 'yarn-berry' : 'yarn-classic');
	}
	throw new Error(
		`Converting ${primary.manager} projects is not supported yet. Drillbit can convert npm and Yarn 1 projects to Yarn ${context.target.version}.`
	);
}
