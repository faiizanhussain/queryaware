# Phase 2 Milestone — Framework-Agnostic Route Discovery

Completed:
- Refactored route discovery into matcher-style pipeline in `src/graph/route-finder.ts`.
- Preserved existing support for call-based routers (`.get/.post/...`) and NestJS decorators.
- Added Next.js support:
  - `app/api/**/route.ts` via exported HTTP method handlers (`GET`, `POST`, etc.)
  - `pages/api/**.ts` via default export handler (`httpMethod: all`)
- Added SvelteKit support:
  - `src/routes/**/+server.ts` via exported HTTP method handlers
- Added deterministic deduplication of route entries.

Outcome:
- Route entry discovery now covers both router-call and file-based full-stack framework patterns, providing broader framework-agnostic behavior for downstream graph phases.
