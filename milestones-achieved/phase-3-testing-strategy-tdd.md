# Phase 3 Milestone — TDD Testing Strategy Foundation

Completed:
- Added graph-focused test runner support in `package.json`:
  - `test:graph`
  - `test:graph:watch`
- Added a Phase 3 test matrix in `test/fixtures/call-graph/`:
  - `named-import-basic`
  - `class-instance-method`
  - `chained-service-calls`
  - `barrel-export`
  - `alias-import`
  - `unresolved-dynamic`
  - `cycle-safe`
- Added fixture contracts for deterministic validation:
  - `expected-edges.json` per fixture
  - `edges.snapshot.json` per fixture
- Added a dedicated graph contract test at `test/graph/call-graph-builder.test.ts` that enforces:
  - exact edge count and tuple matching
  - unresolved-edge reason validation
  - duplicate edge prevention
  - snapshot stability checks
  - failure diagnostics with unresolved summaries and symbol candidates
- Added `src/graph/call-graph-builder.ts` as an explicit stub to keep Phase 3 in red-first TDD mode.

Validation:
- `npm run build` passes.
- `npm run test:graph` currently fails all fixture tests by design because `buildCallGraph` is not implemented yet.

Outcome:
- Phase 3 test strategy is implemented first (TDD-ready), and the project now has a reliable red baseline to drive call-graph implementation incrementally toward green.
