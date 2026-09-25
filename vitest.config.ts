import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			exclude: ['src/Entrypoint.ts'],
			include: ['src/**/*.ts'],
			provider: 'v8',
			reporter: ['text', 'json-summary'],
		},
		environment: 'node',
		env: { DRILLBIT_NO_UPDATE_CHECK: '1' },
		include: ['tests/**/*.test.ts'],
		testTimeout: 30_000,
	},
});
