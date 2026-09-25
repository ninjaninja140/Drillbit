import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, mtimeOrNull, parseJsonObject, readFileIfExists, toPosix } from './fsx.ts';
import type {
	JsonObject,
	LockfileInfo,
	ManagerId,
	PackageLockSnapshot,
	ProjectSnapshot,
	YarnLockSnapshot,
} from './types.ts';

interface LockfileCandidate {
	file: string;
	manager: ManagerId;
}

const LOCKFILE_CANDIDATES: LockfileCandidate[] = [
	{ file: 'package-lock.json', manager: 'npm' },
	{ file: 'npm-shrinkwrap.json', manager: 'npm' },
	{ file: 'yarn.lock', manager: 'yarn' },
	{ file: 'pnpm-lock.yaml', manager: 'pnpm' },
	{ file: 'bun.lock', manager: 'bun' },
	{ file: 'bun.lockb', manager: 'bun' },
];

// Matches vendored releases such as `.yarn/releases/yarn-1.22.22.cjs` or `yarn-4.18.0.js`.
const YARN_RELEASE_FILE = /^yarn-([0-9][0-9A-Za-z.+-]*)\.c?js$/;

async function listVendoredYarnReleases(cwd: string): Promise<string[]> {
	try {
		const entries = await readdir(join(cwd, '.yarn', 'releases'));
		return entries.filter((entry) => YARN_RELEASE_FILE.test(entry)).sort();
	} catch {
		return [];
	}
}

function readLockfileVersion(raw: string): number | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value === 'object' && value !== null && 'lockfileVersion' in value) {
			const version = (value as { lockfileVersion: unknown }).lockfileVersion;
			if (typeof version === 'number') return version;
		}
	} catch {
		return null;
	}
	return null;
}

export async function readProject(cwd: string): Promise<ProjectSnapshot> {
	const packageJsonRaw = await readFileIfExists(join(cwd, 'package.json'));
	const packageJson: JsonObject | null =
		packageJsonRaw === null ? null : parseJsonObject(packageJsonRaw, 'package.json');

	const lockfiles: LockfileInfo[] = [];
	let packageLock: PackageLockSnapshot | null = null;
	let yarnLock: YarnLockSnapshot | null = null;
	for (const candidate of LOCKFILE_CANDIDATES) {
		const absolute = join(cwd, candidate.file);
		const mtimeMs = await mtimeOrNull(absolute);
		if (mtimeMs === null) continue;
		lockfiles.push({ manager: candidate.manager, mtimeMs, path: toPosix(candidate.file) });
		if (candidate.file === 'yarn.lock') {
			yarnLock = {
				manager: 'yarn',
				mtimeMs,
				path: 'yarn.lock',
				raw: (await readFileIfExists(absolute)) ?? '',
			};
		} else if (candidate.manager === 'npm' && packageLock === null) {
			packageLock = {
				lockfileVersion: readLockfileVersion((await readFileIfExists(absolute)) ?? ''),
				manager: 'npm',
				mtimeMs,
				path: candidate.file,
			};
		}
	}

	return {
		cwd,
		gitignore: await readFileIfExists(join(cwd, '.gitignore')),
		legacyYarnrc: await readFileIfExists(join(cwd, '.yarnrc')),
		lockfiles,
		nodeModulesExists: await exists(join(cwd, 'node_modules')),
		npmrc: await readFileIfExists(join(cwd, '.npmrc')),
		packageJson,
		packageJsonRaw,
		packageLock,
		vendoredYarnReleases: await listVendoredYarnReleases(cwd),
		yarnLock,
		yarnrcYml: await readFileIfExists(join(cwd, '.yarnrc.yml')),
	};
}
