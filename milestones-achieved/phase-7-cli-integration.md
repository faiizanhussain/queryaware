# Phase 7 Milestone — CLI Integration

Completed:
- Added `--skip-graph` flag to the `scan` command in `src/cli.ts`.
- Added `--skip-static` flag to the `scan` command in `src/cli.ts`.
- Wired both flags through to `scanTarget(targetPath, options)` as:
  - `skipGraph: options.skipGraph`
  - `skipStatic: options.skipStatic`
- Preserved existing `scan` behavior when flags are omitted (`false` defaults).

Testing strategy completed:
- Added dedicated CLI pass-through suite at `test/graph/cli-phase7.test.ts` validating:
  - `--skip-graph` forwards scanner options correctly
  - `--skip-static` forwards scanner options correctly
  - both flags together forward both booleans as `true`
  - no flags keep both booleans `false`
- Added assertions that `reportIssues` remains invoked for scan output under all flag combinations.
- Added built-binary smoke test at `test/graph/cli-e2e-smoke.test.ts` validating:
  - `dist/bin/queryaware.js` executes end-to-end via Node subprocess
  - `scan` command exits successfully for skip-flag smoke scenario

Validation:
- `npm run test:graph` passes locally.
- `npm run build` passes locally.

Outcome:
- Phase 7 is complete: CLI users can now control static and graph analysis execution via explicit skip flags, enabling full Phase 8 reporter integration.
