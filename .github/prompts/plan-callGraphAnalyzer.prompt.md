## Plan: Call Graph Analyzer

**Current baseline**: The scanner remains regex/line-based for static detectors, but AST foundations are now in place (`ts-morph`, graph types, project loader, and route discovery). The `scan` command still exists unchanged, so graph phases can be integrated incrementally without breaking current behavior.

---

### Phase 1 — Dependencies & AST Foundation
- [x] Add `ts-morph` to `dependencies` in `package.json`
- [x] Create `src/graph/types.ts` — define shared interfaces: `RouteEntry`, `CallNode`, `CallEdge`, `SinkNode`, `TracedPath`, `CallGraphResult`
- [x] Create `src/graph/project-loader.ts` — `loadProject(targetDir: string): Project`, uses ts-morph `Project`, loads all `*.ts` files, respects `tsconfig.json` if present in target dir

### Phase 2 — Route Entrypoint Discovery
- [x] Create `src/graph/route-finder.ts` — `findRouteEntries(project: Project): RouteEntry[]`
  - Detects `.get(path, handler)`, `.post(...)`, etc. (Express/Fastify/NestJS)
  - Handles both inline arrow function handlers and identifier references to named functions
  - Extended with framework adapters for file-based routing (Next.js app/pages API routes, SvelteKit `+server.ts` handlers)
  - `RouteEntry` carries: `{ file, line, httpMethod, routePath, handlerNode }`

### Phase 3 — Call Graph Builder *(hardest step)*
- [x] Create `src/graph/call-graph-builder.ts` — `buildCallGraph(project: Project): CallGraph`
  - Iterates all source files, collects all `CallExpression` nodes
  - Resolves each callee symbol to its definition via ts-morph `getDefinitions()`
  - **Named import chain**: resolves through import declaration → target file declaration
  - **Class instance method**: infers receiver type via ts-morph type inference → looks up method on that class declaration
  - Marks unresolvable calls as `{ unresolved: true, reason: string }` (dynamic call, external package, etc.) — never crashes, never silently skips
- [ ] `CallGraph` type: `Map<nodeKey, CallEdge[]>`

#### Phase 3 Testing Strategy (must pass before Phase 4)
- [x] Add test runner and script support for graph unit tests
  - Add `vitest` (or `node:test`) and `npm` scripts: `test:graph`, `test:graph:watch`
  - Keep tests focused on `src/graph/call-graph-builder.ts` with no Prisma/path tracing dependency
- [x] Build deterministic fixture harness
  - Add fixture directory: `test/fixtures/call-graph/*`
  - Each fixture contains 2–4 TypeScript files and expected edges in JSON
  - Normalize paths to POSIX separators for snapshot stability on Windows/macOS/Linux
- [x] Define minimum fixture matrix (in order)
  - `named-import-basic`: `caller.ts` imports `target()` from `callee.ts`, expect one resolved cross-file edge
  - `class-instance-method`: `new Service().getFiles()` resolves to class method definition
  - `chained-service-calls`: `route -> serviceA -> serviceB` across 3 files, expect full edge chain
  - `barrel-export`: `index.ts` re-export chain still resolves to real declaration
  - `alias-import`: `import { target as renamedTarget }` resolves correctly
  - `unresolved-dynamic`: dynamic/member call marks unresolved with explicit reason, no throw
  - `cycle-safe`: mutually recursive calls do not loop infinitely; graph build completes
- [x] Assertion contract for every fixture
  - Assert exact edge count and exact `(from.file, from.symbol) -> (to.file, to.symbol)` tuples
  - Assert `unresolved === true` edges always include non-empty `reason`
  - Assert no duplicate edges for same source/target pair
  - Assert stable node keys independent of file traversal order
- [x] Add regression snapshots for human review
  - Snapshot serialized graph edges per fixture (`edges.snapshot.json`)
  - PR diff should clearly show resolution changes when behavior shifts
- [x] Add failure diagnostics
  - On assertion failure, print unresolved edge table with file, line, symbol, reason
  - Include nearest symbol candidates to speed debugging of wrong resolutions
- [~] Define Phase 3 exit criteria (hard gate)
  - All Phase 3 fixtures pass locally and in CI *(local complete; CI pending)*
  - At least one verified cross-file named import path and one class instance method path are green
  - No unhandled exceptions on unresolved/dynamic patterns
  - Only after this gate is green can Phase 4–8 work start

### Phase 4 — Prisma Sink Detection (AST-based)
- [x] Create `src/graph/sink-detector.ts` — `findPrismaSinks(project: Project): SinkNode[]`
  - Uses ts-morph to find `prisma.<model>.<operation>(...)` `CallExpression` nodes
  - `SinkNode`: `{ file, line, model, operation }`

#### Phase 4 Testing Strategy (must pass before Phase 5)
- [x] Add sink-focused fixture matrix under `test/fixtures/sink-detector/*`
  - `basic-find-many`: detects `prisma.file.findMany(...)`
  - `multiple-model-operations`: detects multiple sink operations in one file
  - `ignore-non-prisma`: does not treat `db.<model>.<operation>` as Prisma sink
  - `ignore-two-segment`: does not treat `prisma.$connect()` as a sink
- [x] Add dedicated sink contract test in `test/graph/sink-detector.test.ts`
  - Verifies exact `(file, model, operation)` tuples per fixture
  - Verifies deterministic snapshots via `sinks.snapshot.json`
  - Fails clearly if sink detector throws on a fixture
- [~] Define Phase 4 exit criteria (hard gate)
  - `npm run test:graph` passes locally and in CI *(local complete; CI pending)*
  - `npm run build` passes locally and in CI *(local complete; CI pending)*
  - Positive and negative sink fixtures remain green

### Phase 5 — Path Tracer
- [x] Create `src/graph/path-tracer.ts` — `tracePaths(entries, graph, sinks): TracedPath[]`
  - BFS/DFS from each `RouteEntry` through call edges until hitting a `SinkNode` or dead end
  - `TracedPath`: `{ route, hops[{file, fn, line}], sink | null, hasUnresolvedHops }`
  - Includes cycle detection (visited set per traversal)
  - Routes with no DB sink emitted with `sink: null` — useful to report, not dropped

#### Phase 5 Testing Strategy (must pass before Phase 6)
- [x] Add path-tracer fixture matrix under `test/fixtures/path-tracer/*`
  - `route-to-sink-chain`: route → service → repo reaches Prisma sink
  - `unresolved-dead-end`: unresolved dynamic edge surfaces `hasUnresolvedHops`
  - `no-sink-route`: route chain with no sink emits `sink: null`
  - `cycle-no-sink`: cyclic call chain terminates safely with finite path output
- [x] Add dedicated tracer contract test in `test/graph/path-tracer.test.ts`
  - Verifies route metadata + ordered hop chain + sink metadata + unresolved flags
  - Verifies deterministic snapshots via `paths.snapshot.json`
  - Fails clearly if end-to-end graph pipeline throws per fixture
- [~] Define Phase 5 exit criteria (hard gate)
  - `npm run test:graph` passes locally and in CI *(local complete; CI pending)*
  - `npm run build` passes locally and in CI *(local complete; CI pending)*
  - Positive and negative tracer fixtures remain green

### Phase 6 — Scanner Integration
- [x] Extend `ScanResult` in `src/scanner.ts` to include `paths?: TracedPath[]`
- [x] Add `options: { skipGraph?: boolean, skipStatic?: boolean }` param to `scanTarget`
- [x] After regex scan completes, run graph pipeline (load → routes → graph → sinks → trace), merge result into `ScanResult`

#### Phase 6 Testing Strategy (must pass before Phase 7)
- [x] Add scanner integration coverage in `test/graph/scanner-phase6.test.ts`
  - default behavior: runs static detectors and graph pipeline together
  - `skipGraph`: preserves static detection while omitting traced paths
  - `skipStatic`: preserves graph tracing while omitting static issues
  - no-route project: returns deterministic `paths: []` when graph is enabled
  - dual skip flags: returns empty static result without graph output
- [x] Add fixture set under `test/fixtures/scanner-integration/*`
  - `mixed-static-and-graph`: static anti-patterns + traceable route→sink chain
  - `no-routes`: graph-enabled scan with no route entries
- [~] Define Phase 6 exit criteria (hard gate)
  - `npm run test:graph` passes locally and in CI *(local complete; CI pending)*
  - `npm run build` passes locally and in CI *(local complete; CI pending)*
  - Skip-flag option behavior remains stable under fixture tests

### Phase 7 — CLI Integration
- [x] Add `--skip-graph` flag to `scan` command in `src/cli.ts`
- [x] Add `--skip-static` flag to `scan` command in `src/cli.ts`
- [x] Pass both flags through to `scanTarget` options

#### Phase 7 Testing Strategy (must pass before Phase 8)
- [x] Add CLI option pass-through tests in `test/graph/cli-phase7.test.ts`
  - `--skip-graph` forwards `skipGraph: true`
  - `--skip-static` forwards `skipStatic: true`
  - both flags together forward both booleans as `true`
  - no flags defaults both booleans to `false`
- [x] Keep reporter invocation behavior stable under new flag combinations
  - `reportIssues` remains called once with scanner results
- [x] Add built-binary smoke test in `test/graph/cli-e2e-smoke.test.ts`
  - Executes `dist/bin/queryaware.js` via Node subprocess
  - Verifies `scan` command completes with exit code `0` for skip-flag smoke case
- [~] Define Phase 7 exit criteria (hard gate)
  - `npm run test:graph` passes locally and in CI *(local complete; CI pending)*
  - `npm run build` passes locally and in CI *(local complete; CI pending)*
  - CLI scan options remain backward-compatible with default invocation

### Phase 8 — Reporter Extension
- [x] Add `reportPaths(paths: TracedPath[])` to `src/reporter.ts`
  - Groups by route, shows each hop in the chain, highlights Prisma sink at end
  - Unresolved hop inline: `? unresolved (dynamic dispatch)`
  - Route with no sink: `ℹ no DB access found`
- [x] Call `reportPaths` from `src/cli.ts` scan action after `reportIssues`

#### Phase 8 Testing Strategy
- [x] `test/graph/reporter-phase8.test.ts` — 8 unit tests for `reportPaths` output
- [x] `test/graph/cli-phase8.test.ts` — 5 wiring tests including call-order check
- [x] `test/graph/cli-e2e-smoke.test.ts` — extended to 2 binary smoke tests; second verifies `queryaware path analysis` + `GET /files` in stdout

#### Phase 8 exit criteria
- [~] 39/39 tests passing across 8 test files (`npm run test:graph`)
- [~] `npm run build` succeeds with zero TypeScript errors

---

**Relevant files to modify**
- `package.json` — add `ts-morph`
- `src/scanner.ts` — extend `ScanResult`, add options, run graph pipeline
- `src/cli.ts` — add `--skip-graph`, `--skip-static` flags
- `src/reporter.ts` — add `reportPaths`

**New files to create**
- ✅ `src/graph/types.ts`
- ✅ `src/graph/project-loader.ts`
- ✅ `src/graph/route-finder.ts`
- `src/graph/call-graph-builder.ts`
- `src/graph/sink-detector.ts`
- ✅ `src/graph/path-tracer.ts`

---

**Verification**
1. `npm run build` passes with no TypeScript errors
2. Manually test named import chain: `route.ts` → `getFiles()` in `file.service.ts` → `prisma.file.findMany()`
3. Manually test class instance chain: `new FileService()` → `service.getFiles()` → Prisma call
4. Verify `--skip-graph` reverts to existing regex-only behavior
5. Verify unresolved call logs `reason` and doesn't crash the scan
6. Verify routes with no DB access show `ℹ no DB access found` instead of disappearing
