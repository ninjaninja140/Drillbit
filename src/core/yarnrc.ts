import { Document, parseDocument } from 'yaml';
import { isJsonObject, type JsonObject, type LinkerId } from './types.ts';

export interface LegacyYarnrcEntry {
	key: string;
	value: string | null;
}

function unquote(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && first === last) return trimmed.slice(1, -1);
	}
	return trimmed;
}

// Parses the Yarn 1 `.yarnrc` format. Entries are either `key value` or `--key value` lines, with
// values optionally quoted.
export function parseLegacyYarnrc(raw: string): LegacyYarnrcEntry[] {
	const entries: LegacyYarnrcEntry[] = [];
	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const separator = line.search(/[\s=]/);
		const rawKey = separator === -1 ? line : line.slice(0, separator);
		const key = rawKey.replace(/^--?/, '').trim();
		if (key === '') continue;
		let rawValue = separator === -1 ? null : line.slice(separator + 1).trim();
		if (rawValue !== null && /^['"]/.test(rawValue) === false) {
			const comment = rawValue.search(/\s#/);
			if (comment !== -1) rawValue = rawValue.slice(0, comment).trim();
		}
		entries.push({ key, value: unquote(rawValue) });
	}
	return entries;
}

const STRING_SETTINGS: Record<string, string> = {
	'cache-folder': 'cacheFolder',
	cafile: 'caFilePath',
	'global-folder': 'globalFolder',
	'http-proxy': 'httpProxy',
	'https-proxy': 'httpsProxy',
	registry: 'npmRegistryServer',
};

// Yarn 1 flags whose Yarn 4 counterpart is the inverted boolean.
const INVERTED_BOOLEAN_SETTINGS: Record<string, string> = {
	'ignore-scripts': 'enableScripts',
	'strict-ssl': 'enableStrictSsl',
};

const NUMBER_SETTINGS: Record<string, string> = {
	'network-concurrency': 'networkConcurrency',
	'network-timeout': 'httpTimeout',
};

const IGNORED_SETTINGS = new Set(['disable-self-update-check', 'lastUpdateCheck', 'update-notifier', 'user-agent']);

// Yarn 1 keys that Drillbit replaces itself instead of migrating.
const HANDLED_SETTINGS = new Set(['yarn-path']);

export interface UnsupportedSetting {
	key: string;
	reason: string;
	value: string | null;
}

export interface YarnrcMigration {
	ignored: string[];
	notes: string[];
	settings: JsonObject;
	unsupported: UnsupportedSetting[];
}

function toBoolean(value: string | null): boolean | null {
	if (value === null) return true;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return null;
}

function toNumber(value: string | null): number | null {
	if (value === null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

// Maps a Yarn 1 `.yarnrc` (or `.npmrc`-style) key/value pair onto a Yarn 4 setting.
export function migrateSetting(
	key: string,
	value: string | null
): { setting: string; value: unknown } | UnsupportedSetting {
	const stringSetting = STRING_SETTINGS[key];
	if (stringSetting !== undefined) {
		if (value === null || value === '') return { key, reason: 'has no value', value };
		return { setting: stringSetting, value };
	}
	const invertedSetting = INVERTED_BOOLEAN_SETTINGS[key];
	if (invertedSetting !== undefined) {
		const bool = toBoolean(value);
		if (bool === null) return { key, reason: `cannot read "${value}" as a boolean`, value };
		return { setting: invertedSetting, value: !bool };
	}
	const numberSetting = NUMBER_SETTINGS[key];
	if (numberSetting !== undefined) {
		const number = toNumber(value);
		if (number === null) return { key, reason: `cannot read "${value}" as a number`, value };
		return { setting: numberSetting, value: number };
	}
	if (key === 'save-exact') return { setting: 'defaultSemverRangePrefix', value: '' };
	if (key === 'save-prefix') {
		if (value === '' || value === '^' || value === '~') return { setting: 'defaultSemverRangePrefix', value };
		return { key, reason: `unsupported prefix "${value ?? ''}"`, value };
	}
	return { key, reason: 'has no Yarn 4 equivalent', value };
}

export function migrateLegacyYarnrc(raw: string | null): YarnrcMigration {
	const migration: YarnrcMigration = { ignored: [], notes: [], settings: {}, unsupported: [] };
	if (raw === null) return migration;
	for (const entry of parseLegacyYarnrc(raw)) {
		if (IGNORED_SETTINGS.has(entry.key)) {
			migration.ignored.push(entry.key);
			continue;
		}
		if (HANDLED_SETTINGS.has(entry.key)) {
			migration.notes.push(`\`${entry.key}\` was replaced by the Drillbit-managed \`yarnPath\``);
			continue;
		}
		const result = migrateSetting(entry.key, entry.value);
		if ('setting' in result) migration.settings[result.setting] = result.value;
		else migration.unsupported.push(result);
	}
	return migration;
}

// `.npmrc` keys Drillbit understands well enough to carry over into `.yarnrc.yml`.
const NPMRC_SETTINGS = new Set([
	'cafile',
	'http-proxy',
	'https-proxy',
	'ignore-scripts',
	'network-concurrency',
	'network-timeout',
	'registry',
	'save-exact',
	'save-prefix',
	'strict-ssl',
]);

const CREDENTIAL_KEY = /(_auth|_password|_username|:email|:password|:username)/i;

export interface NpmrcMigration {
	// Keys that hold registry credentials; never copied, only reported.
	credentials: string[];
	settings: JsonObject;
}

export function migrateNpmrc(raw: string | null): NpmrcMigration {
	const migration: NpmrcMigration = { credentials: [], settings: {} };
	if (raw === null) return migration;
	// `.npmrc` uses the same `key=value` syntax as `.yarnrc`.
	for (const entry of parseLegacyYarnrc(raw)) {
		if (CREDENTIAL_KEY.test(entry.key)) {
			migration.credentials.push(entry.key);
			continue;
		}
		if (!NPMRC_SETTINGS.has(entry.key)) continue;
		const result = migrateSetting(entry.key, entry.value);
		if ('setting' in result) migration.settings[result.setting] = result.value;
	}
	return migration;
}

export interface YarnrcYmlRead {
	error: string | null;
	values: JsonObject;
}

// The linker a project already uses, when `.yarnrc.yml` says so.
export function readLinker(raw: string | null): LinkerId | null {
	const value = readYarnrcYml(raw).values.nodeLinker;
	return value === 'node-modules' || value === 'pnp' ? value : null;
}

export function readYarnrcYml(raw: string | null): YarnrcYmlRead {
	if (raw === null || raw.trim() === '') return { error: null, values: {} };
	try {
		const document = parseDocument(raw);
		if (document.errors.length > 0) return { error: document.errors[0]?.message ?? 'invalid YAML', values: {} };
		const values: unknown = document.toJS();
		if (values === null || values === undefined) return { error: null, values: {} };
		if (!isJsonObject(values)) return { error: 'expected a mapping of settings', values: {} };
		return { error: null, values };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), values: {} };
	}
}

// Merges settings into an existing `.yarnrc.yml`, keeping comments and unrelated settings intact.
export function mergeYarnrcYml(raw: string | null, updates: JsonObject): string {
	const document: Document = raw === null || raw.trim() === '' ? new Document({}) : parseDocument(raw);
	if (document.errors.length > 0) {
		throw new Error(`Cannot read .yarnrc.yml: ${document.errors[0]?.message ?? 'invalid YAML'}`);
	}
	if (document.contents === null) document.contents = document.createNode({});
	for (const [key, value] of Object.entries(updates)) document.set(key, value);
	const serialized = document.toString();
	return serialized.endsWith('\n') ? serialized : `${serialized}\n`;
}
