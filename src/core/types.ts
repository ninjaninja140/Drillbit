export type ManagerId = 'bun' | 'npm' | 'pnpm' | 'yarn';

export type YarnFlavor = 'berry' | 'classic';

export type Confidence = 'high' | 'low' | 'medium';

export type LinkerId = 'node-modules' | 'pnp';

export type JsonObject = Record<string, unknown>;

export interface LockfileInfo {
	manager: ManagerId;
	mtimeMs: number;
	// Path relative to the project root, always using forward slashes.
	path: string;
}

export interface PackageLockSnapshot extends LockfileInfo {
	lockfileVersion: number | null;
}

export interface YarnLockSnapshot extends LockfileInfo {
	raw: string;
}

// Everything Drillbit reads from disk before deciding what a project uses.
export interface ProjectSnapshot {
	cwd: string;
	gitignore: string | null;
	legacyYarnrc: string | null;
	lockfiles: LockfileInfo[];
	npmrc: string | null;
	nodeModulesExists: boolean;
	packageJson: JsonObject | null;
	packageJsonRaw: string | null;
	packageLock: PackageLockSnapshot | null;
	vendoredYarnReleases: string[];
	yarnLock: YarnLockSnapshot | null;
	yarnrcYml: string | null;
}

export interface DetectedManager {
	confidence: Confidence;
	evidence: string[];
	flavor: YarnFlavor | null;
	manager: ManagerId;
	// Exact version when the project pins one.
	version: string | null;
	// Version range when only a family can be inferred (e.g. `1.x`).
	versionRange: string | null;
}

export interface Detection {
	// True when several managers left traces and nothing declared a winner.
	ambiguous: boolean;
	lockfiles: LockfileInfo[];
	primary: DetectedManager | null;
	rivals: DetectedManager[];
	warnings: string[];
}

export interface MigrationTarget {
	linker: LinkerId;
	manager: ManagerId;
	version: string;
}

// Sink for human-readable progress. Steps never write to the terminal directly.
export interface Reporter {
	info(message: string): void;
	success(message: string): void;
	warn(message: string): void;
}

export interface MigrationContext {
	cwd: string;
	detection: Detection;
	dryRun: boolean;
	install: boolean;
	project: ProjectSnapshot;
	reporter: Reporter;
	target: MigrationTarget;
}

export interface StepResult {
	details?: string[];
}

export interface MigrationStep {
	id: string;
	// Steps that write straight to the terminal (their output must not be wrapped in a spinner).
	live?: boolean;
	run(context: MigrationContext): Promise<StepResult | undefined>;
	title: string;
}

export interface MigrationDescriptor {
	// One-line explanation shown before the plan is confirmed.
	describe(context: MigrationContext): string;
	id: string;
	plan(context: MigrationContext): MigrationStep[];
	source: ManagerId;
	target: ManagerId;
	title: string;
}

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
