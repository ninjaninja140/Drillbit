import { join } from 'node:path';
import { downloadFile, type DownloadResult } from './fsx.ts';

// Used when the npm registry cannot be reached; keep it recent.
export const FALLBACK_YARN_VERSION = '4.18.0';

const CLI_DIST_LATEST = 'https://registry.npmjs.org/@yarnpkg/cli-dist/latest';

export interface ResolvedYarnVersion {
	source: 'fallback' | 'registry';
	version: string;
}

export function yarnReleaseUrl(version: string): string {
	return `https://repo.yarnpkg.com/${version}/packages/yarnpkg-cli/bin/yarn.js`;
}

// Relative path of the vendored release, always using forward slashes.
export function yarnReleaseRelativePath(version: string): string {
	return `.yarn/releases/yarn-${version}.cjs`;
}

export function yarnReleasePath(cwd: string, version: string): string {
	return join(cwd, '.yarn', 'releases', `yarn-${version}.cjs`);
}

export function yarnMajor(version: string): number {
	return Number.parseInt(version.split('.')[0] ?? '', 10);
}

export function isYarnBerryVersion(version: string): boolean {
	const major = yarnMajor(version);
	return Number.isInteger(major) && major >= 2;
}

export async function downloadYarnRelease(cwd: string, version: string): Promise<DownloadResult> {
	return downloadFile(yarnReleaseUrl(version), yarnReleasePath(cwd, version), 120_000);
}

// Asks the npm registry for the newest published Yarn CLI and falls back to a known-good version
// when the network is unavailable.
export async function resolveLatestYarnVersion(): Promise<ResolvedYarnVersion> {
	try {
		const response = await fetch(CLI_DIST_LATEST, { signal: AbortSignal.timeout(10_000) });
		if (response.ok) {
			const body: unknown = await response.json();
			const version = (body as { version?: unknown }).version;
			if (typeof version === 'string' && isYarnBerryVersion(version)) return { source: 'registry', version };
		}
	} catch {
		// fall through to the pinned fallback
	}
	return { source: 'fallback', version: FALLBACK_YARN_VERSION };
}
