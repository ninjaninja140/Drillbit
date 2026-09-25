import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../helpers/workspace.ts';
import {
	detectEol,
	detectIndent,
	downloadFile,
	editJsonText,
	exists,
	mtimeOrNull,
	parseJsonObject,
	readFileIfExists,
	removePath,
	toPosix,
	withPackageManagerField,
	writeFileEnsured,
} from '../../../src/core/fsx.ts';

describe('toPosix', () => {
	it('converts Windows separators', () => {
		expect(toPosix('a\\b\\c')).toBe('a/b/c');
		expect(toPosix('a/b')).toBe('a/b');
	});
});

describe('detectIndent', () => {
	it('reads the first indented property', () => {
		expect(detectIndent('{\n\t"a": 1\n}')).toBe('\t');
		expect(detectIndent('{\n    "a": 1\n}')).toBe('    ');
		expect(detectIndent('{}')).toBe('  ');
	});
});

describe('detectEol', () => {
	it('prefers CRLF when the document contains one', () => {
		expect(detectEol('a\r\nb')).toBe('\r\n');
		expect(detectEol('a\nb')).toBe('\n');
	});
});

describe('parseJsonObject', () => {
	it('rejects invalid JSON and non-objects', () => {
		expect(() => parseJsonObject('nope', 'package.json')).toThrow(/package\.json is not valid JSON/);
		expect(() => parseJsonObject('[1]', 'package.json')).toThrow(/must contain a JSON object/);
		expect(() => parseJsonObject('null', 'package.json')).toThrow(/must contain a JSON object/);
		expect(parseJsonObject('{"a":1}', 'x')).toStrictEqual({ a: 1 });
	});
});

describe('editJsonText', () => {
	it('keeps indentation, line endings and key order', () => {
		const raw = '{\r\n\t"name": "demo",\r\n\t"version": "1.0.0"\r\n}\r\n';
		const edited = editJsonText(raw, (value) => {
			value.private = true;
		});
		expect(edited).toBe('{\r\n\t"name": "demo",\r\n\t"version": "1.0.0",\r\n\t"private": true\r\n}\r\n');
	});

	it('does not add a trailing newline to a file without one', () => {
		const edited = editJsonText('{"a": 1}', (value) => {
			value.b = 2;
		});
		expect(edited).toBe('{\n  "a": 1,\n  "b": 2\n}');
	});
});

describe('withPackageManagerField', () => {
	it('inserts the field after version', () => {
		const raw = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "license": "MIT"\n}\n';
		expect(withPackageManagerField(raw, 'yarn@4.18.0')).toBe(
			'{\n  "name": "demo",\n  "version": "1.0.0",\n  "packageManager": "yarn@4.18.0",\n  "license": "MIT"\n}\n'
		);
	});

	it('replaces an existing field instead of duplicating it', () => {
		const raw = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "packageManager": "npm@10.0.0"\n}\n';
		const updated = withPackageManagerField(raw, 'yarn@4.18.0');
		expect(updated).toBe('{\n  "name": "demo",\n  "version": "1.0.0",\n  "packageManager": "yarn@4.18.0"\n}\n');
		expect(updated.match(/packageManager/g)).toHaveLength(1);
	});

	it('appends the field when there is no version', () => {
		const updated = withPackageManagerField('{"name": "demo"}', 'yarn@4.18.0');
		expect(updated).toBe('{\n  "name": "demo",\n  "packageManager": "yarn@4.18.0"\n}');
	});
});

describe('filesystem helpers', () => {
	it('round-trips files and reports what is missing', async () => {
		const workspace = await createWorkspace();
		try {
			expect(await exists(workspace.path('nested/file.txt'))).toBe(false);
			expect(await readFileIfExists(workspace.path('nested/file.txt'))).toBeNull();
			expect(await mtimeOrNull(workspace.path('nested/file.txt'))).toBeNull();
			expect(await removePath(workspace.path('nested'))).toBe(false);

			await writeFileEnsured(workspace.path('nested/file.txt'), 'hello');
			expect(await readFileIfExists(workspace.path('nested/file.txt'))).toBe('hello');
			expect(await exists(workspace.path('nested/file.txt'))).toBe(true);
			expect(typeof (await mtimeOrNull(workspace.path('nested/file.txt')))).toBe('number');
			expect(await removePath(workspace.path('nested'))).toBe(true);
			expect(await exists(workspace.path('nested'))).toBe(false);
		} finally {
			await workspace.cleanup();
		}
	});
});

describe('downloadFile', () => {
	const cases: { body: Uint8Array | string; expectRejection?: RegExp; name: string; status?: number }[] = [
		{
			body: '',
			expectRejection: /Downloaded an empty file from https:\/\/example\.test\/yarn\.js/,
			name: 'empty body',
		},
		{ body: 'not found', expectRejection: /HTTP 404 Not Found/, name: 'HTTP error', status: 404 },
	];

	it('writes the downloaded bytes and reports their size', async () => {
		const workspace = await createWorkspace();
		try {
			const body = '// yarn release\n';
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200, statusText: 'OK' }));
			const result = await downloadFile(
				'https://example.test/yarn.js',
				workspace.path('.yarn/releases/yarn.cjs')
			);
			expect(result).toStrictEqual({ bytes: body.length, url: 'https://example.test/yarn.js' });
			expect(await workspace.read('.yarn/releases/yarn.cjs')).toBe(body);
		} finally {
			vi.restoreAllMocks();
			await workspace.cleanup();
		}
	});

	for (const testCase of cases) {
		it(`rejects on ${testCase.name}`, async () => {
			const workspace = await createWorkspace();
			try {
				vi.spyOn(globalThis, 'fetch').mockResolvedValue(
					new Response(testCase.body, {
						status: testCase.status ?? 200,
						statusText: testCase.status ? 'Not Found' : 'OK',
					})
				);
				await expect(
					downloadFile('https://example.test/yarn.js', workspace.path('.yarn/releases/yarn.cjs'))
				).rejects.toThrow(testCase.expectRejection);
				expect(workspace.exists('.yarn/releases/yarn.cjs')).toBe(false);
			} finally {
				vi.restoreAllMocks();
				await workspace.cleanup();
			}
		});
	}
});
