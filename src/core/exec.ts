import { execa } from 'execa';

export interface RunOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	// Streams the child's output to the terminal instead of capturing it.
	live?: boolean;
}

export interface CommandResult {
	exitCode: number;
	failed: boolean;
	stderr: string;
	stdout: string;
}

function toResult(result: {
	exitCode?: number | undefined;
	failed: boolean;
	stderr?: string | undefined;
	stdout?: string | undefined;
}): CommandResult {
	return {
		exitCode: result.exitCode ?? (result.failed ? 1 : 0),
		failed: result.failed,
		stderr: result.stderr ?? '',
		stdout: result.stdout ?? '',
	};
}

async function spawn(file: string, args: string[], options: RunOptions): Promise<CommandResult> {
	const live = options.live === true;
	const result = await execa(file, args, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		reject: false,
		stdio: live ? 'inherit' : 'pipe',
	});
	const command = `${file} ${args.join(' ')}`.trim();
	const converted = toResult(result);
	if (converted.failed && result.exitCode === undefined) {
		throw new Error(`Could not run \`${command}\`: ${summarizeOutput(converted) || 'the process never started'}`);
	}
	return converted;
}

export async function run(command: string, args: string[], options: RunOptions): Promise<CommandResult> {
	return spawn(command, args, options);
}

// Runs a JavaScript file with the same Node.js binary that is executing Drillbit.
export async function runNodeScript(script: string, args: string[], options: RunOptions): Promise<CommandResult> {
	return spawn(process.execPath, [script, ...args], options);
}

// Keeps the last few interesting lines of failed command output for error messages.
export function summarizeOutput(result: CommandResult, maxLines = 12): string {
	const lines = `${result.stderr}\n${result.stdout}`
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.trim() !== '');
	return lines.slice(-maxLines).join('\n');
}
