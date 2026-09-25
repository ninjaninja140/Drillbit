import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isJsonObject, type JsonObject } from './types.ts';

export function toPosix(path: string): string {
	return path.replace(/\\/g, '/');
}

export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function mtimeOrNull(path: string): Promise<number | null> {
	try {
		const stats = await stat(path);
		return stats.mtimeMs;
	} catch {
		return null;
	}
}

export async function readFileIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return null;
	}
}

export async function writeFileEnsured(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, 'utf8');
}

// Removes a file or directory tree. Returns false when the path did not exist.
export async function removePath(path: string): Promise<boolean> {
	if (!(await exists(path))) return false;
	await rm(path, { force: true, recursive: true });
	return true;
}

export function parseJsonObject(raw: string, label: string): JsonObject {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isJsonObject(value)) throw new Error(`${label} must contain a JSON object`);
	return value;
}

// Indentation of the first indented property, falling back to two spaces.
export function detectIndent(raw: string): string {
	const match = /^[\t ]+(?=[^\s])/m.exec(raw);
	return match?.[0] ?? '  ';
}

export function detectEol(raw: string): string {
	return raw.includes('\r\n') ? '\r\n' : '\n';
}

// Applies a mutation to a JSON document while keeping its indentation, line endings and key order.
export function editJsonText(raw: string, mutate: (value: JsonObject) => void): string {
	const value = parseJsonObject(raw, 'JSON document');
	mutate(value);
	const eol = detectEol(raw);
	const serialized = JSON.stringify(value, null, detectIndent(raw)).replaceAll('\n', eol);
	return raw.endsWith(eol) ? `${serialized}${eol}` : serialized;
}

// Writes `packageManager` into a `package.json`, keeping the field next to `version` so it lands
// where Yarn itself would put it.
export function withPackageManagerField(raw: string, spec: string): string {
	return editJsonText(raw, (value) => {
		const entries = Object.entries(value).filter(([key]) => key !== 'packageManager');
		const versionIndex = entries.findIndex(([key]) => key === 'version');
		entries.splice(versionIndex === -1 ? entries.length : versionIndex + 1, 0, ['packageManager', spec]);
		for (const key of Object.keys(value)) delete value[key];
		for (const [key, entry] of entries) value[key] = entry;
	});
}

export interface DownloadResult {
	bytes: number;
	url: string;
}

export async function downloadFile(url: string, destination: string, timeoutMs = 30_000): Promise<DownloadResult> {
	const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) {
		throw new Error(`Failed to download ${url} (HTTP ${response.status} ${response.statusText})`);
	}
	const body = new Uint8Array(await response.arrayBuffer());
	if (body.byteLength === 0) throw new Error(`Downloaded an empty file from ${url}`);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, body);
	return { bytes: body.byteLength, url };
}
