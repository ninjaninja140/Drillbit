import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../helpers/workspace.ts';
import {
	downloadYarnRelease,
	FALLBACK_YARN_VERSION,
	isYarnBerryVersion,
	resolveLatestYarnVersion,
	yarnMajor,
	yarnReleasePath,
	yarnReleaseRelativePath,
	yarnReleaseUrl,
} from '../../../src/core/yarn.ts';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('release paths and URLs', () => {
	it('builds the download URL', () => {
		expect(yarnReleaseUrl('4.18.0')).toBe('https://repo.yarnpkg.com/4.18.0/packages/yarnpkg-cli/bin/yarn.js');
	});

	it('builds the relative and absolute release paths', () => {
		expect(yarnReleaseRelativePath('4.18.0')).toBe('.yarn/releases/yarn-4.18.0.cjs');
		expect(yarnReleasePath('C:/project', '4.18.0')).toBe(
			join('C:/project', '.yarn', 'releases', 'yarn-4.18.0.cjs')
		);
		expect(yarnReleasePath('C:/project', '4.18.0')).toMatch(/[\\/]releases[\\/]yarn-4\.18\.0\.cjs$/);
	});
});

describe('isYarnBerryVersion', () => {
	it('accepts Yarn 2 and newer releases only', () => {
		expect(isYarnBerryVersion('2.0.0')).toBe(true);
		expect(isYarnBerryVersion('4.18.0')).toBe(true);
		expect(isYarnBerryVersion('4.0.0-rc.1')).toBe(true);
		expect(isYarnBerryVersion('1.22.12')).toBe(false);
		expect(isYarnBerryVersion('latest')).toBe(false);
	});

	it('exposes the major version', () => {
		expect(yarnMajor('4.18.0')).toBe(4);
		expect(yarnMajor('nonsense')).toBeNaN();
	});
});

describe('resolveLatestYarnVersion', () => {
	it('returns the version the registry advertises', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: '4.19.0' })));
		await expect(resolveLatestYarnVersion()).resolves.toStrictEqual({ source: 'registry', version: '4.19.0' });
	});

	it('falls back when the registry is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		await expect(resolveLatestYarnVersion()).resolves.toStrictEqual({
			source: 'fallback',
			version: FALLBACK_YARN_VERSION,
		});
	});

	it('falls back on an HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503, statusText: 'down' })));
		await expect(resolveLatestYarnVersion()).resolves.toStrictEqual({
			source: 'fallback',
			version: FALLBACK_YARN_VERSION,
		});
	});

	it('falls back when the advertised version is not Yarn 2+', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: '1.22.22' })));
		await expect(resolveLatestYarnVersion()).resolves.toStrictEqual({
			source: 'fallback',
			version: FALLBACK_YARN_VERSION,
		});
	});

	it('falls back when the response is not the expected shape', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: 4 })));
		await expect(resolveLatestYarnVersion()).resolves.toStrictEqual({
			source: 'fallback',
			version: FALLBACK_YARN_VERSION,
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
		await expect(resolveLatestYarnVersion()).resolves.toStrictEqual({
			source: 'fallback',
			version: FALLBACK_YARN_VERSION,
		});
	});

	it('asks the @yarnpkg/cli-dist manifest', async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json({ version: '4.19.0' }));
		vi.stubGlobal('fetch', fetchMock);
		await resolveLatestYarnVersion();
		expect(fetchMock).toHaveBeenCalledWith(
			'https://registry.npmjs.org/@yarnpkg/cli-dist/latest',
			expect.objectContaining({ signal: expect.anything() })
		);
	});
});

describe('downloadYarnRelease', () => {
	it('vendors the release into .yarn/releases', async () => {
		const workspace = await createWorkspace();
		try {
			const body = '// yarn 4.18.0\n';
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
			const result = await downloadYarnRelease(workspace.dir, '4.18.0');
			expect(result.url).toBe(yarnReleaseUrl('4.18.0'));
			expect(result.bytes).toBe(body.length);
			expect(await workspace.read(yarnReleaseRelativePath('4.18.0'))).toBe(body);
		} finally {
			await workspace.cleanup();
		}
	});
});
