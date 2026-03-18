# queryaware

`queryaware` is a TypeScript CLI that performs static analysis on JavaScript/TypeScript source files to detect ORM query anti-patterns (especially Prisma usage) without running your app.

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

## Usage

```bash
npx @catisho/queryaware scan ./src
npx @catisho/queryaware scan ./src --verbose
npx @catisho/queryaware scan ./src --fix
```

After installing as a dev dependency, you can also run:

```bash
queryaware scan ./src
```

`--fix` is currently scaffolded and not implemented yet.

Path analysis output behavior:

- default: compact list of files that contain Prisma/DB access
- `--verbose`: full route-to-call-chain output (hops, unresolved markers, sink lines)

Exit codes:

- `0`: no issues found
- `1`: one or more issues found (useful for CI and pre-commit checks)

## Husky pre-commit hook

Auto-setup (recommended):

```bash
npx @catisho/queryaware setup-husky --path ./src
```

This command creates or updates `.husky/pre-commit` automatically.

It writes a managed block (`# queryaware:start` / `# queryaware:end`) so rerunning the command after package updates refreshes only the queryaware hook command without breaking your other custom hook steps.

Example `.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx queryaware scan ./src
```

If issues are detected, `queryaware` exits with code `1` and the commit is blocked.

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