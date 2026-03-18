# queryaware

`queryaware` is a TypeScript CLI that performs static analysis on JavaScript/TypeScript source files to detect ORM query anti-patterns (especially Prisma usage) without running your app.

**Landing page:** [queryaware.quivlabs.com](https://queryaware.quivlabs.com)

## Why it exists

Database anti-patterns like N+1 queries and unscoped reads often pass tests but hurt performance and tenant isolation in production. `queryaware` scans your codebase ahead of runtime and can block commits when it finds risky query patterns.

## The N+1 problem (real example)

Bad (N+1):

```ts
const files = await prisma.file.findMany({ where: { projectId } });

for (const file of files) {
  const owner = await prisma.user.findUnique({
    where: { id: file.ownerId }
  });
  console.log(owner?.email);
}
```

This produces 1 query for files + N queries for owners.

Better (batched):

```ts
const files = await prisma.file.findMany({ where: { projectId } });
const ownerIds = files.map((f) => f.ownerId);

const owners = await prisma.user.findMany({
  where: { id: { in: ownerIds } }
});
```

## Installation

```bash
npm install --save-dev @catisho/queryaware
```

For local development of this repository:

```bash
npm install
npm run build
```

## Commands

### `scan`

Scan a folder for ORM query anti-patterns. Runs two pipelines:

- **Static detector** — regex/line-based checks (fast, no type resolution)
- **Call-graph tracer** — traces HTTP routes → services → DB sinks via the TypeScript AST

```bash
queryaware scan <targetPath> [options]
```

| Flag | Description |
|------|-------------|
| `--verbose` | Show full call-hop paths, DB access file list, and per-route operation breakdown |
| `--skip-graph` | Skip the call-graph/AST tracing pipeline (faster for static-only runs) |
| `--skip-static` | Skip the static regex/line-based detectors (run call-graph tracing only) |
| `--fix` | *(coming soon)* Automatically fix detected issues where safe to do so |

Examples:

```bash
queryaware scan ./src                    # full analysis
queryaware scan ./src --verbose          # full call paths + DB access files
queryaware scan ./src --skip-graph       # static checks only (faster)
queryaware scan ./src --skip-static      # call-graph tracing only
```

Exit codes:

- `0` — no issues found
- `1` — one or more issues found (useful for CI and pre-commit hooks)

### `setup-husky`

Add `queryaware` to your Husky pre-commit hook automatically.

```bash
queryaware setup-husky [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--path <targetPath>` | `./src` | Source folder to scan in the pre-commit hook |
| `--hook-file <hookFilePath>` | `.husky/pre-commit` | Husky hook file to write the command into |

```bash
npx @catisho/queryaware setup-husky --path ./src
```

Creates or updates `.husky/pre-commit` with a managed block (`# queryaware:start` / `# queryaware:end`) so rerunning after package updates refreshes only the queryaware step without breaking other custom hook steps.

Example generated hook:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx queryaware scan ./src
```

If issues are detected, `queryaware` exits with code `1` and the commit is blocked.

## Output

### Scan results

```
queryaware scanning ./src...
  • static detector: running
  • call-graph tracer: running
scan complete in 312ms

queryaware scan results
─────────────────────────────────────────
  3 issues in 2 files  ·  High: 2  Medium: 1

src/services/file.service.ts  (2)
  ✖ N+1 Query  :47  prisma.user.findUnique()  [High]
     Impact: query explosion causes latency spikes and DB load growth
     Fix:    use findMany({ where: { id: { in: ids } } })
  ✖ Unscoped findMany  :61  prisma.document.findMany()  [High]
     Impact: full table scan + data leak risk in multi-tenant setup

src/services/user.service.ts  (1)
  ✖ Sequential writes  :23  prisma.user.upsert()  [Medium]
     Impact: N writes in series increase lock time and reduce throughput
     Fix:    batch with createMany/updateMany or a transaction

─────────────────────────────────────────
✖ 3 issues found  High: 2  Medium: 1
```

### Path analysis — default (compact)

```
queryaware path analysis
─────────────────────────────────────────
  routes traced: 8  •  DB access: 3 files
  top operations: prisma.file.findMany, prisma.user.findUnique, prisma.document.findMany

  run with --verbose to see the full file list and call paths
─────────────────────────────────────────
```

### Path analysis — `--verbose`

```
queryaware path analysis
─────────────────────────────────────────
summary: routes=8 paths=12 sinks=9 no-sink=3 unresolved=2
display limits: routes=50, paths/route=5, hops/path=8

[1/8] GET /files
  paths=2 sinks=2 unresolved=0
  path 1/2
  src/routes/file.route.ts#getFiles:12
  → src/services/file.service.ts#getFiles:34
  ↳ prisma.file.findMany  src/services/file.service.ts

[2/8] GET /users/:id
  paths=1 sinks=1 unresolved=0
  path 1/1
  src/routes/user.route.ts#getUser:8
  → src/services/user.service.ts#getUserById:19
  ↳ prisma.user.findUnique  src/services/user.service.ts

─────────────────────────────────────────

## Supported patterns

### 1) N+1 query in loops

Detects Prisma calls inside loop bodies.

Bad:

```ts
for (const item of items) {
  await prisma.file.findUnique({ where: { id: item.id } });
}
```

Good:

```ts
await prisma.file.findMany({ where: { id: { in: items.map((i) => i.id) } } });
```

### 2) Unscoped `findMany`

Flags `findMany` calls where the next 3 lines do not contain `where`.

Bad:

```ts
const docs = await prisma.document.findMany({
  select: { id: true }
});
```

Good:

```ts
const docs = await prisma.document.findMany({
  where: { workspaceId },
  select: { id: true }
});
```

### 3) Sequential writes in loops

Detects `create`, `upsert`, or `update` calls inside loops.

Bad:

```ts
for (const input of inputs) {
  await prisma.user.upsert({
    where: { email: input.email },
    create: input,
    update: input
  });
}
```

Good:

```ts
await prisma.user.createMany({ data: inputs });
```

### 4) Unsafe raw query

Flags `$queryRawUnsafe` and `$executeRawUnsafe` — these pass user input directly to the database with no parameterization.

Bad:

```ts
await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${userId}`);
```

Good:

```ts
await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userId}`;
```

### 5) `Prisma.raw()` fragment injection

Flags `Prisma.raw(...)` used inside a `Prisma.sql` template — the fragment is injected verbatim and breaks parameterization boundaries.

Bad:

```ts
await prisma.$queryRaw(Prisma.sql`SELECT * FROM ${Prisma.raw(table)}`);
```

Good:

```ts
await prisma.$queryRaw`SELECT * FROM "user" WHERE id = ${userId}`;
```

### 6) Raw `SELECT *`

Flags `SELECT *` in raw SQL strings — over-fetches data and may expose sensitive columns.

Bad:

```ts
await prisma.$queryRaw`SELECT * FROM documents`;
```

Good:

```ts
await prisma.$queryRaw`SELECT id, title, owner_id FROM documents`;
```

### 7) Raw `DELETE` without `WHERE`

Flags DELETE statements with no WHERE clause — a full-table deletion with no undo.

Bad:

```ts
await prisma.$executeRaw`DELETE FROM sessions`;
```

Good:

```ts
await prisma.$executeRaw`DELETE FROM sessions WHERE expires_at < NOW()`;
```

### 8) Raw `UPDATE` without `WHERE`

Flags UPDATE statements with no WHERE clause — every row would be overwritten.

Bad:

```ts
await prisma.$executeRaw`UPDATE users SET active = false`;
```

Good:

```ts
await prisma.$executeRaw`UPDATE users SET active = false WHERE last_login < ${cutoff}`;
```

## What has improved

### v0.2.0

- **Call-graph tracer** — new AST-based pipeline that resolves HTTP route handlers → service calls → DB sinks, tracing through named imports, barrel exports, class instance methods, and chained service calls
- **Sink detection** — detects `this.prisma.model.op()` (NestJS DI pattern), `prisma.$queryRaw` tagged template literals, and `$queryRaw`/`$executeRaw` raw SQL methods
- **Raw SQL analysis** — five new static checks: unsafe raw queries, `Prisma.raw()` fragments, `SELECT *`, `DELETE` without `WHERE`, and `UPDATE` without `WHERE`; SQL context gating prevents false positives in non-SQL strings
- **Reporter** — issues grouped by file with severity badges (`[High]` / `[Medium]`), per-issue impact and fix hints; default mode shows a compact summary; `--verbose` shows full route-to-sink call chains
- **CLI** — `--skip-graph` and `--skip-static` flags to run either pipeline independently; improved `--help` text with examples

### v0.1.1

- Initial release: N+1 detection, unscoped `findMany`, sequential writes in loops
- Husky pre-commit hook auto-setup via `setup-husky`