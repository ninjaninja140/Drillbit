import {
	clackState,
	CLACK_CANCEL,
	takeConfirmResult,
	takeSelectResult,
	type ConfirmCall,
	type SelectCall,
} from './clack-state.ts';

export { CLACK_CANCEL };

// A recording, queue-driven stand-in for `@clack/prompts`. Tests import it through
// `vi.mock('@clack/prompts', ...)` so `src/cli/ui.ts` talks to this instead of a terminal.
export async function select<T>(options: SelectCall): Promise<T> {
	clackState().selects.push(options);
	const result = takeSelectResult();
	return (result === CLACK_CANCEL ? CLACK_CANCEL : result) as T;
}

export async function confirm(options: ConfirmCall): Promise<boolean> {
	clackState().confirms.push(options);
	return takeConfirmResult() as boolean;
}

export function isCancel(value: unknown): boolean {
	return value === CLACK_CANCEL;
}

export function intro(message: string): void {
	clackState().logs.push({ kind: 'intro', message });
}

export function outro(message: string): void {
	clackState().outros.push(message);
}

export function note(body: string, title: string): void {
	clackState().notes.push({ body, title });
}

export function cancel(message: string): void {
	clackState().cancels.push(message);
}

function record(kind: string) {
	return (message: string): void => {
		clackState().logs.push({ kind, message });
	};
}

export const log = {
	error: record('error'),
	info: record('info'),
	message: record('message'),
	step: record('step'),
	success: record('success'),
	warn: record('warn'),
};

export function spinner(): { start: (message: string) => void; stop: (message: string) => void } {
	const entry = { starts: [] as string[], stops: [] as string[] };
	clackState().spinners.push(entry);
	return {
		start: (message) => entry.starts.push(message),
		stop: (message) => entry.stops.push(message),
	};
}
