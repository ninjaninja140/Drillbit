import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { toPosix } from '../../src/core/fsx.ts';

// A disposable directory tree used as a pretend project: every path is relative to its root.
export interface Workspace {
	readonly dir: string;
	cleanup(): Promise<void>;
	exists(relative: string): boolean;
	listFiles(): Promise<string[]>;
	path(relative: string): string;
	read(relative: string): Promise<string>;
	readIfExists(relative: string): Promise<string | null>;
	remove(relative: string): Promise<void>;
	// Every file and its contents, for "this run changed nothing" assertions
	snapshot(): Promise<Record<string, string>>;
	touch(relative: string, mtimeMs: number): Promise<void>;
	write(relative: string, content: string): Promise<void>;
}

async function listFilesIn(root: string, prefix: string): Promise<string[]> {
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relative = prefix === '' ? entry.name : join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...(await listFilesIn(root, relative)));
		else files.push(toPosix(relative));
	}
	return files.sort();
}

export async function createWorkspace(prefix = 'drillbit-test-'): Promise<Workspace> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	return {
		cleanup: () => rm(dir, { force: true, recursive: true }),
		dir,
		exists: (relative) => existsSync(join(dir, relative)),
		listFiles: () => listFilesIn(dir, ''),
		path: (relative) => join(dir, relative),
		read: (relative) => readFile(join(dir, relative), 'utf8'),
		readIfExists: async (relative) => {
			try {
				return await readFile(join(dir, relative), 'utf8');
			} catch {
				return null;
			}
		},
		remove: (relative) => rm(join(dir, relative), { force: true, recursive: true }),
		snapshot: async () => {
			const contents: Record<string, string> = {};
			for (const file of await listFilesIn(dir, '')) contents[file] = await readFile(join(dir, file), 'utf8');
			return contents;
		},
		touch: async (relative, mtimeMs) => {
			const time = new Date(mtimeMs);
			await utimes(join(dir, relative), time, time);
		},
		write: async (relative, content) => {
			const absolute = join(dir, relative);
			await mkdir(dirname(absolute), { recursive: true });
			await writeFile(absolute, content, 'utf8');
		},
	};
}
