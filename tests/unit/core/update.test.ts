import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	compareVersions,
	findUpdate,
	isNewerVersion,
	latestPublishedVersion,
	outOfDateMessage,
} from '../../../src/core/update.ts';

const NPM_LATEST = 'https://registry.npmjs.org/drillbit/latest';
const GITHUB_LATEST = 'https://api.github.com/repos/ninjaninja140/Drillbit/releases/latest';

type Source = { body: unknown; status?: number } | 'offline';

// Answers both places Drillbit looks, and refuses anything else so a stray request fails loudly.
function stubSources(npm: Source, github: Source): string[] {
	const asked: string[] = [];
	vi.stubGlobal('fetch', async (url: string) => {
		asked.push(url);
		const source = url === NPM_LATEST ? npm : url === GITHUB_LATEST ? github : undefined;
		if (source === undefined) throw new Error(`Unexpected request to ${url}`);
		if (source === 'offline') throw new Error('offline');
		return new Response(JSON.stringify(source.body), { status: source.status ?? 200 });
	});
	return asked;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('compareVersions', () => {
	it('orders the release numbers', () => {
		expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
		expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
		expect(compareVersions('1.2.3', '1.3.0')).toBeLessThan(0);
		expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
	});

	it('sorts a pre-release below the release it leads to', () => {
		expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBeLessThan(0);
		expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBeGreaterThan(0);
	});

	it('orders pre-release identifiers the way semver does', () => {
		expect(compareVersions('1.2.3-rc.2', '1.2.3-rc.1')).toBeGreaterThan(0);
		expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.9')).toBeGreaterThan(0);
		expect(compareVersions('1.2.3-beta.1', '1.2.3-rc.1')).toBeLessThan(0);
		expect(compareVersions('1.2.3-1', '1.2.3-alpha')).toBeLessThan(0);
		expect(compareVersions('1.2.3-rc', '1.2.3-rc.1')).toBeLessThan(0);
	});

	it('ignores a leading v and any build metadata', () => {
		expect(compareVersions('v1.2.3+build.5', '1.2.3')).toBe(0);
		expect(compareVersions('v0.2.0', '0.1.0')).toBeGreaterThan(0);
	});
});

describe('isNewerVersion', () => {
	it('is true only for a newer release', () => {
		expect(isNewerVersion('0.1.1', '0.1.0')).toBe(true);
		expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
		expect(isNewerVersion('0.1.0-rc.1', '0.1.0')).toBe(false);
		expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
		expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
	});
});

describe('latestPublishedVersion', () => {
	it('asks npm and GitHub at once and prefers npm', async () => {
		const asked = stubSources({ body: { version: '0.2.0' } }, { body: { tag_name: 'v0.3.0' } });

		await expect(latestPublishedVersion()).resolves.toStrictEqual({ source: 'npm', version: '0.2.0' });
		expect(asked).toStrictEqual([NPM_LATEST, GITHUB_LATEST]);
	});

	it('falls back to the GitHub releases when Drillbit is not on npm', async () => {
		stubSources({ body: {}, status: 404 }, { body: { tag_name: 'v0.2.0' } });

		await expect(latestPublishedVersion()).resolves.toStrictEqual({ source: 'github', version: '0.2.0' });
	});

	it('ignores an answer that is not a version', async () => {
		stubSources({ body: { version: 'latest' } }, { body: { tag_name: 'v0.2.0' } });

		await expect(latestPublishedVersion()).resolves.toStrictEqual({ source: 'github', version: '0.2.0' });
	});

	it('returns null when neither place answers', async () => {
		stubSources('offline', { body: {}, status: 500 });

		await expect(latestPublishedVersion()).resolves.toBeNull();
	});

	it('returns null when the bodies are not objects', async () => {
		stubSources({ body: 'nope' }, { body: null });

		await expect(latestPublishedVersion()).resolves.toBeNull();
	});
});

describe('findUpdate', () => {
	it('reports the newer release next to the running version', async () => {
		stubSources({ body: { version: '0.2.0' } }, { body: { tag_name: 'v0.2.0' } });

		await expect(findUpdate('0.1.0')).resolves.toStrictEqual({ current: '0.1.0', latest: '0.2.0' });
	});

	it('prefers the release over a pre-release of it', async () => {
		stubSources({ body: { version: '0.2.0' } }, { body: { tag_name: 'v0.2.0' } });

		await expect(findUpdate('0.2.0-rc.1')).resolves.toStrictEqual({ current: '0.2.0-rc.1', latest: '0.2.0' });
	});

	it('stays quiet when the running version is current or newer', async () => {
		stubSources({ body: { version: '0.1.0' } }, { body: { tag_name: 'v0.1.0' } });

		await expect(findUpdate('0.1.0')).resolves.toBeNull();
		await expect(findUpdate('0.2.0')).resolves.toBeNull();
	});

	it('stays quiet when the lookup failed', async () => {
		stubSources('offline', 'offline');

		await expect(findUpdate('0.1.0')).resolves.toBeNull();
	});
});

describe('outOfDateMessage', () => {
	it('names both versions', () => {
		expect(outOfDateMessage({ current: '0.1.0', latest: '0.2.0' })).toBe(
			'Drillbit is out of date! We recommend updating drillbit to its latest release from whichever method you installed drillbit! (0.1.0 -> 0.2.0)'
		);
	});
});
