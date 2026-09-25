import { afterEach, vi } from 'vitest';

export interface CapturedOutput {
	stderr(): string;
	stdout(): string;
	restore(): void;
}

// Captures everything written to `process.stdout`/`process.stderr` (Drillbit uses those directly
// for its `--help`/`--version` output and for usage errors).
export function captureOutput(): CapturedOutput {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
		stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
		return true;
	}) as typeof process.stdout.write);
	const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
		stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
		return true;
	}) as typeof process.stderr.write);

	const restore = (): void => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	};
	afterEach(restore);

	return {
		restore,
		stderr: () => stderr.join(''),
		stdout: () => stdout.join(''),
	};
}

// Pretends the process is attached to a terminal, which `run()` checks before prompting.
export function pretendTty(): void {
	const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
	Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
	afterEach(() => {
		if (original === undefined) Reflect.deleteProperty(process.stdin, 'isTTY');
		else Object.defineProperty(process.stdin, 'isTTY', original);
	});
}
