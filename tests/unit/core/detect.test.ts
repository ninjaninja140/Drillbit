import { describe, expect, it } from 'vitest';
import { lockfile, packageLock, snapshot, yarnLock } from '../../helpers/context.ts';
import {
	detectFromSnapshot,
	formatManager,
	npmVersionRange,
	parsePackageManagerField,
	versionFromYarnRelease,
	yarnFlavorOf,
	yarnLockFlavor,
} from '../../../src/core/detect.ts';

describe('parsePackageManagerField', () => {
	it('reads the declared manager and version', () => {
		expect(parsePackageManagerField('yarn@4.18.0')).toStrictEqual({
			manager: 'yarn',
			raw: '4.18.0',
			version: '4.18.0',
		});
		expect(parsePackageManagerField('yarn@1.22.12+sha512.abc')).toStrictEqual({
			manager: 'yarn',
			raw: '1.22.12+sha512.abc',
			version: '1.22.12',
		});
		expect(parsePackageManagerField('pnpm@9')).toStrictEqual({ manager: 'pnpm', raw: '9', version: null });
	});

	it('ignores anything that is not a known manager', () => {
		expect(parsePackageManagerField('yarn')).toBeNull();
		expect(parsePackageManagerField('gradle@1.0.0')).toBeNull();
		expect(parsePackageManagerField('@bracketed/cli@1.0.0')).toBeNull();
		expect(parsePackageManagerField(undefined)).toBeNull();
	});
});

describe('versionFromYarnRelease', () => {
	it('finds the version in yarnPath values and file names', () => {
		expect(versionFromYarnRelease('yarn-4.18.0.cjs')).toBe('4.18.0');
		expect(versionFromYarnRelease('.yarn/releases/yarn-1.22.12.cjs')).toBe('1.22.12');
		expect(versionFromYarnRelease('.yarn\\releases\\yarn-4.18.0.js')).toBe('4.18.0');
		expect(versionFromYarnRelease('yarn-4.0.0-rc.1.cjs')).toBe('4.0.0-rc.1');
	});

	it('returns null when there is no release name', () => {
		expect(versionFromYarnRelease('/usr/local/bin/yarn')).toBeNull();
	});
});

describe('flavor helpers', () => {
	it('classifies Yarn versions', () => {
		expect(yarnFlavorOf('1.22.12')).toBe('classic');
		expect(yarnFlavorOf('4.18.0')).toBe('berry');
		expect(yarnFlavorOf(null)).toBeNull();
	});

	it('classifies lockfiles', () => {
		expect(yarnLockFlavor('# yarn lockfile v1\n\nleft-pad@^1.0.0:\n')).toBe('classic');
		expect(yarnLockFlavor('__metadata:\n  version: 8\n')).toBe('berry');
		expect(yarnLockFlavor('nonsense')).toBeNull();
	});

	it('maps npm lockfile versions onto npm release ranges', () => {
		expect(npmVersionRange(1)).toBe('5 – 6 (lockfileVersion 1)');
		expect(npmVersionRange(3)).toBe('9 or newer (lockfileVersion 3)');
		expect(npmVersionRange(null)).toBeNull();
	});
});

describe('detectFromSnapshot', () => {
	it('recognises an npm project', () => {
		const detection = detectFromSnapshot(
			snapshot({
				lockfiles: [lockfile('npm', 'package-lock.json', 1_700_000_000_000)],
				packageLock: packageLock(3, 1_700_000_000_000),
			})
		);
		expect(detection.ambiguous).toBe(false);
		expect(detection.primary?.manager).toBe('npm');
		expect(detection.primary?.confidence).toBe('medium');
		expect(detection.primary?.versionRange).toBe('9 or newer (lockfileVersion 3)');
		expect(detection.warnings).toStrictEqual([]);
	});

	it('pins the exact Yarn 1 version from yarn-path', () => {
		const detection = detectFromSnapshot(
			snapshot({
				legacyYarnrc: 'yarn-path ".yarn/releases/yarn-1.22.12.cjs"\n',
			})
		);
		expect(detection.primary?.manager).toBe('yarn');
		expect(detection.primary?.flavor).toBe('classic');
		expect(detection.primary?.version).toBe('1.22.12');
		expect(detection.primary?.versionRange).toBeNull();
	});

	it('flags a Yarn 1 lockfile as classic', () => {
		const raw = '# yarn lockfile v1\n\nleft-pad@^1.0.0:\n  version "1.3.0"\n';
		const detection = detectFromSnapshot(
			snapshot({
				lockfiles: [yarnLock(raw)],
				yarnLock: yarnLock(raw),
			})
		);
		expect(detection.primary?.flavor).toBe('classic');
		expect(detection.primary?.versionRange).toBe('1.x');
	});

	it('reads the pinned release out of .yarnrc.yml', () => {
		const detection = detectFromSnapshot(
			snapshot({
				packageJson: { packageManager: 'yarn@4.18.0' },
				vendoredYarnReleases: ['yarn-4.18.0.cjs'],
				yarnrcYml: 'nodeLinker: node-modules\nyarnPath: .yarn/releases/yarn-4.18.0.cjs\n',
			})
		);
		expect(detection.primary?.manager).toBe('yarn');
		expect(detection.primary?.flavor).toBe('berry');
		expect(detection.primary?.version).toBe('4.18.0');
		expect(detection.primary?.confidence).toBe('high');
	});

	it('treats equal-confidence traces as ambiguous and picks the newest lockfile', () => {
		const detection = detectFromSnapshot(
			snapshot({
				lockfiles: [
					lockfile('npm', 'package-lock.json', 2_000_000),
					yarnLock('# yarn lockfile v1\n', 1_000_000),
				],
				packageLock: packageLock(2, 2_000_000),
				yarnLock: yarnLock('# yarn lockfile v1\n', 1_000_000),
			})
		);
		expect(detection.ambiguous).toBe(true);
		expect(detection.primary?.manager).toBe('npm');
		expect(detection.rivals.map((rival) => rival.manager)).toStrictEqual(['yarn']);
		expect(detection.warnings.join('\n')).toMatch(/Assuming npm/);
	});

	it('lets the packageManager field win over other traces', () => {
		const detection = detectFromSnapshot(
			snapshot({
				lockfiles: [lockfile('npm', 'package-lock.json', 2_000_000)],
				packageJson: { packageManager: 'yarn@4.18.0' },
				packageLock: packageLock(3, 2_000_000),
			})
		);
		expect(detection.ambiguous).toBe(false);
		expect(detection.primary?.manager).toBe('yarn');
		expect(detection.rivals.map((rival) => rival.manager)).toStrictEqual(['npm']);
		expect(detection.warnings.join('\n')).toMatch(/declares yarn/);
	});

	it('reports when there is nothing to go on', () => {
		const detection = detectFromSnapshot(snapshot());
		expect(detection.primary).toBeNull();
		expect(detection.warnings.join('\n')).toMatch(/No package manager traces were found/);
	});

	it('warns about a leftover .yarnrc next to .yarnrc.yml', () => {
		const detection = detectFromSnapshot(
			snapshot({
				legacyYarnrc: 'registry "https://registry.npmjs.org"\n',
				yarnrcYml: 'nodeLinker: node-modules\n',
			})
		);
		expect(detection.warnings.join('\n')).toMatch(/\.yarnrc \(Yarn 1\) is still present/);
	});
});

describe('formatManager', () => {
	it('renders flavor and version when they are known', () => {
		expect(
			formatManager({
				confidence: 'high',
				evidence: [],
				flavor: 'berry',
				manager: 'yarn',
				version: '4.18.0',
				versionRange: null,
			})
		).toBe('yarn (berry) 4.18.0');
		expect(
			formatManager({
				confidence: 'low',
				evidence: [],
				flavor: 'classic',
				manager: 'yarn',
				version: null,
				versionRange: '1.x',
			})
		).toBe('yarn (classic) 1.x');
		expect(
			formatManager({
				confidence: 'medium',
				evidence: [],
				flavor: null,
				manager: 'pnpm',
				version: null,
				versionRange: null,
			})
		).toBe('pnpm');
	});
});
