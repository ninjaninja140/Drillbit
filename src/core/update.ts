import { isJsonObject } from './types.ts';

const NPM_LATEST = 'https://registry.npmjs.org/drillbit/latest';
const GITHUB_LATEST = 'https://api.github.com/repos/ninjaninja140/Drillbit/releases/latest';
const LOOKUP_TIMEOUT_MS = 5_000;
const RELEASE_VERSION = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface PublishedRelease {
	source: 'github' | 'npm';
	version: string;
}

export interface UpdateNotice {
	current: string;
	latest: string;
}

interface ReleaseParts {
	prerelease: string[];
	release: number[];
}

function splitVersion(version: string): ReleaseParts {
	const [withoutBuild = ''] = version.trim().replace(/^v/, '').split('+');
	const [release = '', prerelease = ''] = withoutBuild.split('-');
	return {
		prerelease: prerelease === '' ? [] : prerelease.split('.'),
		release: release.split('.').map((part) => Number.parseInt(part, 10)),
	};
}

// Semver's pre-release rule: `1.2.3-rc.1` sorts below `1.2.3`.
function comparePrerelease(left: string[], right: string[]): number {
	if (left.length === 0 || right.length === 0) return right.length - left.length;
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const leftPart = left[index];
		const rightPart = right[index];
		if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
		if (leftPart === rightPart) continue;
		const leftNumber = Number.parseInt(leftPart, 10);
		const rightNumber = Number.parseInt(rightPart, 10);
		const leftIsNumber = String(leftNumber) === leftPart;
		const rightIsNumber = String(rightNumber) === rightPart;
		if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
		if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1;
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

export function compareVersions(left: string, right: string): number {
	const leftParts = splitVersion(left);
	const rightParts = splitVersion(right);
	for (let index = 0; index < Math.max(leftParts.release.length, rightParts.release.length); index += 1) {
		const leftValue = leftParts.release[index] ?? 0;
		const rightValue = rightParts.release[index] ?? 0;
		if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) continue;
		if (leftValue !== rightValue) return leftValue - rightValue;
	}
	return comparePrerelease(leftParts.prerelease, rightParts.prerelease);
}

export function isNewerVersion(candidate: string, current: string): boolean {
	return compareVersions(candidate, current) > 0;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const response = await fetch(url, {
		headers: { accept: 'application/json', ...headers },
		signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
	});
	if (!response.ok) return null;
	return await response.json();
}

function readVersion(body: unknown, key: 'tag_name' | 'version'): string | null {
	if (!isJsonObject(body)) return null;
	const value = body[key];
	if (typeof value !== 'string' || !RELEASE_VERSION.test(value.trim())) return null;
	return value.trim().replace(/^v/, '');
}

async function lookup(
	url: string,
	headers: Record<string, string>,
	key: 'tag_name' | 'version',
	source: PublishedRelease['source']
): Promise<PublishedRelease | null> {
	try {
		const version = readVersion(await fetchJson(url, headers), key);
		return version === null ? null : { source, version };
	} catch {
		// The lookup is advisory, so any network problem just means no notice.
		return null;
	}
}

// Both sources are asked at once; npm wins because that is where a published Drillbit comes from.
export async function latestPublishedVersion(): Promise<PublishedRelease | null> {
	const [npm, github] = await Promise.all([
		lookup(NPM_LATEST, {}, 'version', 'npm'),
		lookup(GITHUB_LATEST, { 'user-agent': 'drillbit' }, 'tag_name', 'github'),
	]);
	return npm ?? github;
}

export async function findUpdate(current: string): Promise<UpdateNotice | null> {
	const latest = await latestPublishedVersion();
	if (latest === null || !isNewerVersion(latest.version, current)) return null;
	return { current, latest: latest.version };
}

export function outOfDateMessage(notice: UpdateNotice): string {
	return `Drillbit is out of date! We recommend updating drillbit to its latest release from whichever method you installed drillbit! (${notice.current} -> ${notice.latest})`;
}
