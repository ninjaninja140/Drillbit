import type { Confidence, Detection, DetectedManager, ManagerId, ProjectSnapshot, YarnFlavor } from './types.ts';
import { readYarnrcYml } from './yarnrc.ts';

const KNOWN_MANAGERS: ManagerId[] = ['npm', 'yarn', 'pnpm', 'bun'];

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

interface Signal {
	confidence: Confidence;
	evidence: string[];
	flavor: YarnFlavor | null;
	manager: ManagerId;
	// Only set for lockfiles: newest lockfile wins an ambiguity, matching what developers last ran.
	timestamp: number;
	version: string | null;
	versionRange: string | null;
}

export interface DeclaredManager {
	manager: ManagerId;
	// Raw value of the `packageManager` field, including any hash.
	raw: string;
	version: string | null;
}

export function parsePackageManagerField(value: unknown): DeclaredManager | null {
	if (typeof value !== 'string') return null;
	const at = value.indexOf('@', 1);
	if (at === -1) return null;
	const name = value.slice(0, at);
	if (!(KNOWN_MANAGERS as string[]).includes(name)) return null;
	const spec = value.slice(at + 1);
	const withoutHash = spec.split('+')[0] ?? spec;
	return {
		manager: name as ManagerId,
		raw: spec,
		version: /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(withoutHash) ? withoutHash : null,
	};
}

export function yarnFlavorOf(version: string | null): YarnFlavor | null {
	if (version === null) return null;
	return version.startsWith('1.') ? 'classic' : 'berry';
}

// Extracts a version from a `yarnPath` value or vendored release filename.
export function versionFromYarnRelease(value: string): string | null {
	const match = /yarn-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.c?js$/.exec(value.replace(/\\/g, '/'));
	return match?.[1] ?? null;
}

export function yarnLockFlavor(raw: string): YarnFlavor | null {
	if (/^# yarn lockfile v1\b/m.test(raw)) return 'classic';
	if (/^__metadata:/m.test(raw)) return 'berry';
	return null;
}

export function npmVersionRange(lockfileVersion: number | null): string | null {
	switch (lockfileVersion) {
		case 1:
			return '5 – 6 (lockfileVersion 1)';
		case 2:
			return '7 – 8 (lockfileVersion 2)';
		case 3:
			return '9 or newer (lockfileVersion 3)';
		default:
			return null;
	}
}

function highestRelease(releases: string[]): { file: string; version: string | null } | null {
	let best: { file: string; version: string | null } | null = null;
	for (const file of releases) {
		const version = versionFromYarnRelease(file);
		if (best === null) {
			best = { file, version };
			continue;
		}
		if (version !== null && (best.version === null || compareVersions(version, best.version) > 0)) {
			best = { file, version };
		}
	}
	return best;
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10));
	const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10));
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
		const leftValue = leftParts[index] ?? 0;
		const rightValue = rightParts[index] ?? 0;
		if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) continue;
		if (leftValue !== rightValue) return leftValue - rightValue;
	}
	return 0;
}

function collectSignals(snapshot: ProjectSnapshot, warnings: string[]): Signal[] {
	const signals: Signal[] = [];
	const declared = parsePackageManagerField(snapshot.packageJson?.packageManager);
	if (declared !== null) {
		signals.push({
			confidence: 'high',
			evidence: [`package.json declares "packageManager": ${declared.manager}@${declared.raw}`],
			flavor: declared.manager === 'yarn' ? yarnFlavorOf(declared.version) : null,
			manager: declared.manager,
			timestamp: 0,
			version: declared.version,
			versionRange: null,
		});
	}

	if (snapshot.yarnrcYml !== null) {
		const parsed = readYarnrcYml(snapshot.yarnrcYml);
		if (parsed.error !== null) warnings.push(`.yarnrc.yml could not be read: ${parsed.error}`);
		const yarnPath = parsed.values.yarnPath;
		if (typeof yarnPath === 'string') {
			const version = versionFromYarnRelease(yarnPath);
			signals.push({
				confidence: 'high',
				evidence: [`.yarnrc.yml pins yarnPath to ${yarnPath}`],
				flavor: yarnFlavorOf(version),
				manager: 'yarn',
				timestamp: 0,
				version,
				versionRange: version === null ? '2 or newer' : null,
			});
		} else {
			signals.push({
				confidence: 'medium',
				evidence: ['.yarnrc.yml is present (Yarn 2+)'],
				flavor: 'berry',
				manager: 'yarn',
				timestamp: 0,
				version: null,
				versionRange: '2 or newer',
			});
		}
	}

	const release = highestRelease(snapshot.vendoredYarnReleases);
	if (release !== null) {
		signals.push({
			confidence: 'medium',
			evidence: [`.yarn/releases/${release.file} is vendored`],
			flavor: yarnFlavorOf(release.version),
			manager: 'yarn',
			timestamp: 0,
			version: release.version,
			versionRange: null,
		});
	}

	if (snapshot.yarnLock !== null) {
		const flavor = yarnLockFlavor(snapshot.yarnLock.raw);
		signals.push({
			confidence: 'medium',
			evidence: [
				flavor === 'classic'
					? 'yarn.lock is a Yarn 1 lockfile ("# yarn lockfile v1")'
					: 'yarn.lock is a Yarn 2+ lockfile ("__metadata:")',
			],
			flavor,
			manager: 'yarn',
			timestamp: snapshot.yarnLock.mtimeMs,
			version: null,
			versionRange: flavor === 'classic' ? '1.x' : '2 or newer',
		});
	} else if (snapshot.legacyYarnrc !== null && snapshot.yarnrcYml === null) {
		const yarnPathEntry = /^[ \t]*(?:--)?yarn-path[ \t]+["']?([^"'\r\n]+)["']?/m.exec(snapshot.legacyYarnrc);
		const version = yarnPathEntry?.[1] === undefined ? null : versionFromYarnRelease(yarnPathEntry[1].trim());
		signals.push({
			confidence: 'low',
			evidence: ['.yarnrc is a Yarn 1 configuration file'],
			flavor: 'classic',
			manager: 'yarn',
			timestamp: 0,
			version,
			versionRange: version === null ? '1.x' : null,
		});
	}

	if (snapshot.packageLock !== null) {
		const range = npmVersionRange(snapshot.packageLock.lockfileVersion);
		signals.push({
			confidence: snapshot.packageLock.lockfileVersion === null ? 'low' : 'medium',
			evidence: [
				`${snapshot.packageLock.path} was written by npm${
					snapshot.packageLock.lockfileVersion === null
						? ''
						: ` (lockfileVersion ${snapshot.packageLock.lockfileVersion})`
				}`,
			],
			flavor: null,
			manager: 'npm',
			timestamp: snapshot.packageLock.mtimeMs,
			version: null,
			versionRange: range,
		});
	}

	for (const lockfile of snapshot.lockfiles) {
		if (lockfile.manager !== 'pnpm' && lockfile.manager !== 'bun') continue;
		signals.push({
			confidence: 'medium',
			evidence: [`${lockfile.path} is present`],
			flavor: null,
			manager: lockfile.manager,
			timestamp: lockfile.mtimeMs,
			version: null,
			versionRange: null,
		});
	}

	return signals;
}

function mergeSignals(signals: Signal[]): DetectedManager[] {
	const groups = new Map<ManagerId, Signal[]>();
	for (const signal of signals) {
		const group = groups.get(signal.manager);
		if (group === undefined) groups.set(signal.manager, [signal]);
		else group.push(signal);
	}

	const merged: DetectedManager[] = [];
	for (const [manager, group] of groups) {
		const ordered = [...group].sort(
			(left, right) =>
				CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence] || right.timestamp - left.timestamp
		);
		const best = ordered[0];
		if (best === undefined) continue;
		merged.push({
			confidence: best.confidence,
			evidence: ordered.flatMap((signal) => signal.evidence),
			flavor: ordered.find((signal) => signal.flavor !== null)?.flavor ?? null,
			manager,
			version: ordered.find((signal) => signal.version !== null)?.version ?? null,
			versionRange: ordered.find((signal) => signal.versionRange !== null)?.versionRange ?? null,
		});
	}
	return merged;
}

function newestTimestamp(detection: DetectedManager, lockfiles: ProjectSnapshot['lockfiles']): number {
	let newest = 0;
	for (const lockfile of lockfiles) {
		if (lockfile.manager === detection.manager && lockfile.mtimeMs > newest) newest = lockfile.mtimeMs;
	}
	return newest;
}

export function detectFromSnapshot(snapshot: ProjectSnapshot): Detection {
	const warnings: string[] = [];
	const signals = collectSignals(snapshot, warnings);
	const managers = mergeSignals(signals);
	const declared = parsePackageManagerField(snapshot.packageJson?.packageManager);

	const byPriority = [...managers].sort(
		(left, right) =>
			(newestTimestamp(right, snapshot.lockfiles) || 0) - (newestTimestamp(left, snapshot.lockfiles) || 0) ||
			KNOWN_MANAGERS.indexOf(left.manager) - KNOWN_MANAGERS.indexOf(right.manager)
	);

	let primary: DetectedManager | null = null;
	let rivals: DetectedManager[] = [];
	let ambiguous = false;

	if (declared !== null) {
		const match = managers.find((manager) => manager.manager === declared.manager);
		if (match !== undefined) {
			primary = match;
			rivals = managers.filter((manager) => manager.manager !== declared.manager);
		}
	}
	if (primary === null && byPriority.length === 1) primary = byPriority[0] ?? null;
	if (primary === null && byPriority.length > 1) {
		primary = byPriority[0] ?? null;
		rivals = byPriority.slice(1);
		ambiguous = true;
	}

	if (primary === null) {
		warnings.push(
			'No package manager traces were found. Drillbit looks for a "packageManager" field, a lockfile, .yarnrc.yml or a vendored Yarn release.'
		);
	} else {
		if (ambiguous) {
			const newest = snapshot.lockfiles
				.filter((lockfile) => lockfile.manager === primary?.manager)
				.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
			warnings.push(
				`Multiple package managers were detected (${[primary.manager, ...rivals.map((rival) => rival.manager)].join(', ')}). Assuming ${primary.manager}${
					newest === undefined ? '' : ` because ${newest.path} is the most recently changed lockfile`
				}.`
			);
		}
		if (declared !== null && rivals.length > 0) {
			warnings.push(
				`package.json declares ${declared.manager} but ${rivals
					.map((rival) => `${rival.manager} traces (${rival.evidence[0] ?? 'unknown'})`)
					.join(', ')} also exist. The declared package manager wins.`
			);
		}
		if (snapshot.legacyYarnrc !== null && snapshot.yarnrcYml !== null) {
			warnings.push('.yarnrc (Yarn 1) is still present next to .yarnrc.yml; Yarn 4 ignores it.');
		}
	}

	return { ambiguous, lockfiles: snapshot.lockfiles, primary, rivals, warnings };
}

export function formatManager(manager: DetectedManager): string {
	const flavor = manager.manager === 'yarn' && manager.flavor !== null ? ` (${manager.flavor})` : '';
	const version = manager.version ?? manager.versionRange;
	return version === null ? `${manager.manager}${flavor}` : `${manager.manager}${flavor} ${version}`;
}
