import { describe, expect, it } from 'vitest';
import {
	migrateLegacyYarnrc,
	migrateNpmrc,
	migrateSetting,
	mergeYarnrcYml,
	parseLegacyYarnrc,
	readLinker,
	readYarnrcYml,
} from '../../../src/core/yarnrc.ts';

describe('parseLegacyYarnrc', () => {
	it('reads every Yarn 1 syntax', () => {
		const entries = parseLegacyYarnrc(
			[
				'# a comment',
				'registry "https://registry.npmjs.org"',
				'--network-timeout 60000',
				'ignore-scripts true # inline comment',
				'save-prefix=~',
				'disable-self-update-check',
				'',
			].join('\n')
		);
		expect(entries).toStrictEqual([
			{ key: 'registry', value: 'https://registry.npmjs.org' },
			{ key: 'network-timeout', value: '60000' },
			{ key: 'ignore-scripts', value: 'true' },
			{ key: 'save-prefix', value: '~' },
			{ key: 'disable-self-update-check', value: null },
		]);
	});
});

describe('migrateSetting', () => {
	it('maps Yarn 1 keys onto Yarn 4 settings', () => {
		expect(migrateSetting('registry', 'https://example.com')).toStrictEqual({
			setting: 'npmRegistryServer',
			value: 'https://example.com',
		});
		// Yarn 4 replaced the negative flag with the positive one, so the value is inverted.
		expect(migrateSetting('ignore-scripts', 'true')).toStrictEqual({ setting: 'enableScripts', value: false });
		expect(migrateSetting('strict-ssl', 'false')).toStrictEqual({ setting: 'enableStrictSsl', value: true });
		expect(migrateSetting('network-timeout', '60000')).toStrictEqual({ setting: 'httpTimeout', value: 60_000 });
		expect(migrateSetting('network-concurrency', '8')).toStrictEqual({ setting: 'networkConcurrency', value: 8 });
		expect(migrateSetting('save-exact', 'true')).toStrictEqual({ setting: 'defaultSemverRangePrefix', value: '' });
		expect(migrateSetting('save-prefix', '^')).toStrictEqual({ setting: 'defaultSemverRangePrefix', value: '^' });
	});

	it('reports what it cannot carry over', () => {
		expect('setting' in migrateSetting('registry', null)).toBe(false);
		expect(migrateSetting('nohoist', 'x')).toStrictEqual({
			key: 'nohoist',
			reason: 'has no Yarn 4 equivalent',
			value: 'x',
		});
		expect('setting' in migrateSetting('network-timeout', 'soon')).toBe(false);
		expect('setting' in migrateSetting('save-prefix', '>=')).toBe(false);
	});
});

describe('migrateLegacyYarnrc', () => {
	it('groups settings, notes and unsupported keys', () => {
		const migration = migrateLegacyYarnrc(
			[
				'registry "https://registry.npmjs.org"',
				'lastUpdateCheck 1699999999999',
				'yarn-path ".yarn/releases/yarn-1.22.12.cjs"',
				'nohoist **',
			].join('\n')
		);
		expect(migration.settings).toStrictEqual({ npmRegistryServer: 'https://registry.npmjs.org' });
		expect(migration.ignored).toStrictEqual(['lastUpdateCheck']);
		expect(migration.notes).toHaveLength(1);
		expect(migration.notes[0] ?? '').toMatch(/yarn-path/);
		expect(migration.unsupported.map((setting) => setting.key)).toStrictEqual(['nohoist']);
	});
});

describe('migrateNpmrc', () => {
	it('carries known settings and never copies credentials', () => {
		const migration = migrateNpmrc(
			[
				'registry=https://registry.npmjs.org/',
				'//registry.npmjs.org/:_authToken=super-secret',
				'//registry.npmjs.org/:username=someone',
				'fund=false',
				'save-exact=true',
			].join('\n')
		);
		expect(migration.settings).toStrictEqual({
			defaultSemverRangePrefix: '',
			npmRegistryServer: 'https://registry.npmjs.org/',
		});
		expect(migration.credentials).toStrictEqual([
			'//registry.npmjs.org/:_authToken',
			'//registry.npmjs.org/:username',
		]);
	});
});

describe('readLinker', () => {
	it('only accepts the two known linkers', () => {
		expect(readLinker('nodeLinker: pnp\n')).toBe('pnp');
		expect(readLinker('nodeLinker: node-modules\n')).toBe('node-modules');
		expect(readLinker('nodeLinker: nonsense\n')).toBeNull();
		expect(readLinker(null)).toBeNull();
		expect(readLinker('yarnPath: .yarn/releases/yarn-4.18.0.cjs\n')).toBeNull();
	});
});

describe('readYarnrcYml', () => {
	it('reports broken YAML instead of throwing', () => {
		const read = readYarnrcYml('nodeLinker: [unclosed\n');
		expect(read.error).not.toBeNull();
		expect(read.values).toStrictEqual({});
	});
});

describe('mergeYarnrcYml', () => {
	it('writes a fresh document', () => {
		expect(mergeYarnrcYml(null, { nodeLinker: 'node-modules' })).toBe('nodeLinker: node-modules\n');
		expect(mergeYarnrcYml('', { nodeLinker: 'pnp' })).toBe('nodeLinker: pnp\n');
	});

	it('keeps existing comments and unrelated settings', () => {
		const existing = ['# keep me', 'nodeLinker: node-modules', 'enableScripts: true', ''].join('\n');
		const merged = mergeYarnrcYml(existing, {
			nodeLinker: 'pnp',
			yarnPath: '.yarn/releases/yarn-4.18.0.cjs',
		});
		expect(merged).toMatch(/# keep me/);
		expect(merged).toMatch(/nodeLinker: pnp/);
		expect(merged).toMatch(/enableScripts: true/);
		expect(merged).toMatch(/yarnPath: \.yarn\/releases\/yarn-4\.18\.0\.cjs/);
		expect(merged.endsWith('\n')).toBe(true);
	});
});
