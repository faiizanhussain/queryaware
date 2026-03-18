# Phase 1 Milestone — Dependencies & AST Foundation

Completed:
- Added `ts-morph` to runtime dependencies in `package.json`.
- Added shared graph contracts in `src/graph/types.ts`:
  - `RouteEntry`, `CallNode`, `CallEdge`, `SinkNode`, `TracedPath`, `CallGraphResult`
- Added AST project bootstrap utility in `src/graph/project-loader.ts`:
  - `loadProject(targetDir: string): Project`
  - Uses `tsconfig.json` in target directory when present
  - Falls back to glob-based `**/*.ts` loading when no tsconfig is found

Outcome:
- The codebase now has the minimum AST infrastructure needed to begin route discovery and call graph construction in Phase 2+.
