import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

// Node 24+ strips the types itself, so the CLI can be spawned straight from source.
export const ENTRYPOINT = fileURLToPath(new URL('../../src/Entrypoint.ts', import.meta.url));

export interface CliRun {
	exitCode: number;
	stderr: string;
	stdout: string;
}

export async function runCli(
	args: string[],
	options: { cwd: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<CliRun> {
	const result = await execa(process.execPath, [ENTRYPOINT, ...args], {
		cwd: options.cwd,
		env: { NO_COLOR: '1', ...options.env },
		reject: false,
		timeout: options.timeoutMs ?? 60_000,
	});
	return {
		exitCode: result.exitCode ?? 1,
		stderr: result.stderr ?? '',
		stdout: result.stdout ?? '',
	};
}
