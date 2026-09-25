export interface SelectCall {
	message: string;
	options: { hint?: string; label: string; value: unknown }[];
}

export interface ConfirmCall {
	initialValue: boolean | undefined;
	message: string;
}

// Returned by the mock when a test wants `isCancel` to be true.
export const CLACK_CANCEL = Symbol('clack-cancel');

export interface LogEntry {
	kind: string;
	message: string;
}

interface ClackState {
	cancels: string[];
	confirms: ConfirmCall[];
	logs: LogEntry[];
	notes: { body: string; title: string }[];
	outros: string[];
	selects: SelectCall[];
	// Values that `select()` returns next, in order.
	selectResults: unknown[];
	confirmResults: unknown[];
	spinners: { starts: string[]; stops: string[] }[];
}

const state: ClackState = {
	cancels: [],
	confirms: [],
	confirmResults: [],
	logs: [],
	notes: [],
	outros: [],
	selectResults: [],
	selects: [],
	spinners: [],
};

export function resetClackState(): void {
	state.cancels.length = 0;
	state.confirms.length = 0;
	state.confirmResults.length = 0;
	state.logs.length = 0;
	state.notes.length = 0;
	state.outros.length = 0;
	state.selectResults.length = 0;
	state.selects.length = 0;
	state.spinners.length = 0;
}

export function clackState(): ClackState {
	return state;
}

// Queues the value the next `select()` call resolves to.
export function queueSelect(value: unknown): void {
	state.selectResults.push(value);
}

// Queues the value the next `confirm()` call resolves to (a boolean, or `CLACK_CANCEL`).
export function queueConfirm(value: unknown): void {
	state.confirmResults.push(value);
}

export function queuedSelectCount(): number {
	return state.selectResults.length;
}

export function queuedConfirmCount(): number {
	return state.confirmResults.length;
}

// Pops a queued answer. Throws instead of waiting, so a prompt the test did not plan for shows up
// as a failure rather than a hang.
export function takeSelectResult(): unknown {
	if (state.selectResults.length === 0) {
		throw new Error(`select() was called but no answer was queued: ${JSON.stringify(state.selects.at(-1))}`);
	}
	return state.selectResults.shift();
}

export function takeConfirmResult(): unknown {
	if (state.confirmResults.length === 0) {
		throw new Error(`confirm() was called but no answer was queued: ${JSON.stringify(state.confirms.at(-1))}`);
	}
	return state.confirmResults.shift();
}

// Messages logged through any `log.*` method, in order.
export function loggedMessages(): string[] {
	return state.logs.map((entry) => entry.message);
}

export function loggedMessagesOf(kind: string): string[] {
	return state.logs.filter((entry) => entry.kind === kind).map((entry) => entry.message);
}
