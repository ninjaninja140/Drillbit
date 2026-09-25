import { detectFromSnapshot } from '../../src/core/detect.ts';
import { createSilentReporter, type CollectingReporter } from '../../src/core/report.ts';
import type {
	Detection,
	LinkerId,
	LockfileInfo,
	ManagerId,
	MigrationContext,
	MigrationTarget,
	PackageLockSnapshot,
	ProjectSnapshot,
	YarnLockSnapshot,
} from '../../src/core/types.ts';

// Kept in sync with the pinned release used throughout the suite.
export const TARGET_YARN_VERSION = '4.18.0';

export function lockfile(manager: ManagerId, path: string, mtimeMs: number): LockfileInfo {
	return { manager, mtimeMs, path };
}

export function yarnLock(raw: string, mtimeMs = 1_000_000): YarnLockSnapshot {
	return { manager: 'yarn', mtimeMs, path: 'yarn.lock', raw };
}

export function packageLock(lockfileVersion: number | null, mtimeMs = 1_000_000): PackageLockSnapshot {
	return { lockfileVersion, manager: 'npm', mtimeMs, path: 'package-lock.json' };
}

export function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
	return {
		cwd: 'C:/project',
		gitignore: null,
		legacyYarnrc: null,
		lockfiles: [],
		npmrc: null,
		nodeModulesExists: false,
		packageJson: {},
		packageJsonRaw: '{}',
		packageLock: null,
		vendoredYarnReleases: [],
		yarnLock: null,
		yarnrcYml: null,
		...overrides,
	};
}

export interface ContextOptions {
	detection?: Detection;
	dryRun?: boolean;
	install?: boolean;
	linker?: LinkerId;
	reporter?: CollectingReporter;
	version?: string;
}

export function createContext(project: ProjectSnapshot, options: ContextOptions = {}): MigrationContext {
	const target: MigrationTarget = {
		linker: options.linker ?? 'node-modules',
		manager: 'yarn',
		version: options.version ?? TARGET_YARN_VERSION,
	};
	return {
		cwd: project.cwd,
		detection: options.detection ?? detectFromSnapshot(project),
		dryRun: options.dryRun ?? false,
		install: options.install ?? true,
		project,
		reporter: options.reporter ?? createSilentReporter(),
		target,
	};
}
