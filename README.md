# Drillbit

A package manager *manager*. Point Drillbit at a project and it works out which package manager — and which version of it — the project actually uses, then converts it to another one without breaking the dependency tree.

Drillbit exists because package manager versions are not interchangeable. A `yarn.lock` written by Yarn 1.22.12 is a different format from the one Yarn 4 writes, `package-lock.json` cannot be reused by Yarn at all, and swapping the lockfile by hand is how dependency trees get corrupted. Drillbit detects the difference and migrates instead of guessing.

## Status

v0.1 handles the two conversions it was built for:

| From                                       | To                                             |
| ------------------------------------------ | ---------------------------------------------- |
| npm (`package-lock.json`, any lockfileVersion) | Yarn 2+ (latest, vendored into `.yarn/releases`) |
| Yarn 1.x classic (`yarn.lock` v1 + `.yarnrc`)  | Yarn 2+ (latest)                               |

Yarn 2+ projects are supported too: pointing Drillbit at one re-pins it to another Yarn release.

Not yet supported (Drillbit says so and stops rather than guessing): pnpm and Bun as sources, and converting away from Yarn.

## Requirements

- Node.js 22 or newer.
- Network access to `registry.npmjs.org` (to look up the latest Yarn and, on every run, the latest Drillbit), `repo.yarnpkg.com` (to download the release) and, when npm has no Drillbit release, `api.github.com` for the releases of `ninjaninja140/Drillbit`. Drillbit falls back to a known-good Yarn version if the registry cannot be reached, and simply stays quiet when a release cannot be found.

## Install

Drillbit is not published to npm yet, so build it from source:

```sh
git clone https://github.com/ninjaninja140/Drillbit.git
cd Drillbit
yarn install
yarn build
node ./dist/Entrypoint.js --help
```

## Usage

```sh
drillbit <command> [directory] [options]
```

Drillbit is command based, which leaves room for more than one conversion later:

| Command               | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `migrate [directory]` | Convert the project to Yarn. This is the v0.1 feature.      |
| `help [command]`      | Show the overall help, or the help of a single command.     |

`drillbit help migrate` and `drillbit migrate --help` show the same thing. A bare `drillbit` prints
the usage and exits with code 2.

`migrate` is the interesting one. Run it inside the project you want to convert, or pass a directory. Everything except the final `yarn install` is a question away, and nothing is written until you confirm the plan.

### Options

| Option                | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `-C, --cwd <dir>`     | Project directory (default: the current directory).                          |
| `-y, --yes`           | Accept the suggested answers and skip confirmations. Needed in CI; see below. |
| `--dry-run`           | Report what would change without touching the project.                       |
| `--linker <name>`     | Yarn linker to use: `node-modules` (default) or `pnp`.                       |
| `--no-install`        | Skip the final `yarn install`.                                               |
| `--yarn-version <v>`  | Yarn version to switch to (default: the latest release).                     |
| `--force`             | Run even when the project already uses the target setup.                     |
| `--dev`               | Skip the production-only checks, such as the update check.                   |
| `-h, --help`          | Show help.                                                                   |
| `-v, --version`       | Show the Drillbit version.                                                   |

### Examples

```sh
# Look first: show the detection and the plan, write nothing
drillbit migrate --dry-run

# Convert npm to the latest Yarn, no questions asked, from CI
drillbit migrate -y

# Upgrade Yarn 1.22.12 to Yarn 4.10.3 with Plug'n'Play, but install later
drillbit migrate --yarn-version 4.10.3 --linker pnp --no-install

# Hack on Drillbit: leave the production-only checks alone
drillbit migrate --dry-run --dev
```

### Staying up to date

Every `migrate` run asks the npm registry, and the GitHub releases of `ninjaninja140/Drillbit` as a
fallback, whether a newer Drillbit exists. When one does, it says so before doing anything else:

```
Drillbit is out of date! We recommend updating drillbit to its latest release from whichever method you installed drillbit! (0.1.0 -> 0.2.0)
```

The lookup is advisory and has a five second budget: an unreachable registry, a missing release or a
slow network never fails the run it was started for. Put `--dev` at the end of the command, or set
`DRILLBIT_NO_UPDATE_CHECK=1`, to skip the check altogether — which is what the test suite does.

> Drillbit asks questions before it changes anything, which needs an interactive terminal. In scripts and CI, pass `--yes` (plus `--yarn-version` if you do not want the latest release looked up).

## How detection works

Drillbit reads the project and ranks what it finds:

1. `packageManager` in `package.json` — high confidence, and it can carry an exact version.
2. `.yarnrc.yml` — the `yarnPath` release (high confidence) or the file alone (`Yarn 2+`, medium).
3. Vendored releases in `.yarn/releases`, then `yarn.lock` — the lockfile header says `Yarn 1` or `Yarn 2+`; a Yarn 1 `.yarnrc` is a low-confidence classic signal.
4. Other lockfiles: `package-lock.json` (with its `lockfileVersion`, which maps to the npm major that wrote it), `pnpm-lock.yaml`, `bun.lock`.

When several managers left traces, the declared `packageManager` wins. If nothing declares one, Drillbit shows you what it found and picks the manager whose lockfile changed most recently, with a warning. Pass `--dry-run` first if you want to check.

The detected version matters: a source of Yarn `1.x` gets the classic-to-Berry lockfile migration, while a Yarn 2+ source keeps its lockfile.

## What a migration changes

Every conversion is a plan, and every plan is shown before it runs:

- Vendors the target Yarn release into `.yarn/releases/yarn-<version>.cjs` (nothing global is installed, and the project stays reproducible).
- Removes install artifacts that cannot be reused: `node_modules`, `.pnp.cjs`, `.yarn/install-state.gz`, `.yarn/build-state.yml`, `.yarn/unplugged`.
- Removes npm lockfiles when converting from npm; superseded vendored Yarn releases are pruned.
- Maps `.npmrc` / `.yarnrc` settings onto `.yarnrc.yml` (`registry` → `npmRegistryServer`, `ignore-scripts true` → `enableScripts false`, `network-timeout` → `httpTimeout`, and so on). Anything without a Yarn 4 equivalent is reported instead of silently dropped.
- Writes `.yarnrc.yml` with `nodeLinker` and `yarnPath`, keeping any settings and comments already in the file.
- Pins `"packageManager": "yarn@<version>"` in `package.json`, keeping the file's indentation, line endings and key order.
- Adds the Yarn block to `.gitignore` (`.yarn/*` with the useful folders un-ignored, plus `node_modules/` or `.pnp.*`).
- Runs the vendored `yarn install` so the new lockfile is generated by the right Yarn version.

Secrets are never copied: registry credentials found in `.npmrc` are reported so you can move them to `npmRegistries.<registry>.npmAuthToken` yourself.

## Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| `0`  | Converted, or already on the target setup, or the user said no.      |
| `1`  | Nothing to convert, the source is unsupported, or a step failed.     |
| `2`  | Bad usage (no command, unknown command or option, no `package.json`, no interactive terminal). |
| `130` | Cancelled at a prompt.                                             |

A failed step leaves the project half-migrated. The error says so; fix the reported problem and run Drillbit again — it is safe to re-run, because detection runs from scratch each time.

## Development

```sh
yarn install     # dependencies (Yarn 4, vendored in .yarn/releases)
yarn typecheck   # tsc --noEmit over src and tests
yarn test        # vitest run
yarn test:watch  # vitest (watch mode)
yarn test:coverage
yarn lint        # biome check .
yarn format      # biome check --write .
yarn build       # tsc → dist/
yarn start       # node ./dist/Entrypoint.js
```

Layout:

- `src/Entrypoint.ts` — the CLI entry point (`bin`), a shebang around `run()`.
- `src/cli/` — argument parsing and command dispatch (`args.ts`), terminal presentation (`@clack/prompts`, `picocolors`) in `ui.ts`, orchestration and exit codes in `run.ts`.
- `src/core/` — the engine: `project.ts` (reads the project), `detect.ts` (detection heuristics), `migrations.ts` (plans and steps), `yarnrc.ts` (`.yarnrc`/`.npmrc` mapping), `yarn.ts` (release URLs and version resolution), `update.ts` (the Drillbit release lookup), `gitignore.ts`, `fsx.ts`, `exec.ts`, `report.ts`.
- `tests/unit/`, `tests/integration/`, `tests/e2e/` — every suite lives under `tests/`; `src/` ships code only.

## Testing

Vitest, in three layers. Nothing in the default run touches the network or the real Yarn release, so `yarn test` is fast and offline.

| Layer       | Files                  | What it covers                                                         |
| ----------- | ---------------------- | ---------------------------------------------------------------------- |
| Unit        | `tests/unit/`          | Detection heuristics, `.yarnrc`/`.npmrc` mapping, version parsing, the update lookup, prompts. |
| Integration | `tests/integration/`   | The real engine and the real `run()` against a temp workspace on disk.  |
| End-to-end  | `tests/e2e/`           | The CLI spawned as a child process, plus opt-in live-registry runs.     |

How the suite stays hermetic:

- **Temp workspaces.** `tests/helpers/workspace.ts` creates a real directory under the OS temp dir and removes it afterwards. Files are written for real; assertions read them back.
- **Stub Yarn.** `tests/helpers/stub-yarn.ts` pre-vendors a fake `.yarn/releases/yarn-<version>.cjs`. A vendored release is itself a detection signal, so fixtures that must look like plain npm projects also declare `"packageManager": "npm@…"`. The stub answers `--version` from its own filename, records every call in `.drillbit-stub.jsonl` and can be told to fail via `DRILLBIT_STUB_FAIL=1`.
- **No release lookup by default.** `vitest.config.ts` sets `DRILLBIT_NO_UPDATE_CHECK=1`, and the few tests that cover the check delete it and stub `fetch` with `vi.stubGlobal`, so the default run never leaves the machine.
- **Mocked prompts.** `src/cli/ui.ts` is the only module that imports `@clack/prompts`; tests mock it with `vi.mock('@clack/prompts', …)` and queue answers (`tests/helpers/clack-mock.ts`). `pretendTty()` stubs `process.stdout.isTTY`, which is unset inside Vitest workers.

The three live tests hit the real registry and download the real Yarn release. They are opt-in and slow (about 15s):

```sh
$env:DRILLBIT_E2E_NETWORK='1'   # PowerShell
yarn test:e2e
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
