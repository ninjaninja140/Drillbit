import type { Reporter } from './types.ts';

export function createSilentReporter(): Reporter {
	return { info: () => undefined, success: () => undefined, warn: () => undefined };
}

export type CollectingReporter = Reporter & { lines: string[] };

export function createCollectingReporter(): CollectingReporter {
	const lines: string[] = [];
	return {
		info: (message) => lines.push(`info    ${message}`),
		lines,
		success: (message) => lines.push(`success ${message}`),
		warn: (message) => lines.push(`warn    ${message}`),
	};
}
