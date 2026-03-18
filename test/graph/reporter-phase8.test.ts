import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { reportPaths } from "../../src/reporter.js";
import type { TracedPath } from "../../src/graph/types.js";

function abs(suffix: string): string {
  return resolve(process.cwd(), suffix);
}

function captureLines(fn: () => void): string[] {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  fn();
  const lines = spy.mock.calls.map((args) => String(args[0] ?? ""));
  spy.mockRestore();
  return lines;
}

function makePath(overrides: Partial<TracedPath> & Pick<TracedPath, "hops" | "sink">): TracedPath {
  return {
    route: {
      file: abs("test/fixtures/reporter/route.ts"),
      line: 7,
      httpMethod: "get",
      routePath: "/files",
      handlerNode: undefined as any
    },
    hasUnresolvedHops: false,
    ...overrides
  };
}

describe("reportPaths Phase 8", () => {
  it("empty paths prints section header and no-routes message", () => {
    const lines = captureLines(() => reportPaths([], { verbose: true }));

    expect(lines.some((l) => l.includes("queryaware path analysis"))).toBe(true);
    expect(lines.some((l) => l.includes("No routes found"))).toBe(true);
  });

  it("fully resolved path with sink shows route header, all hops, and sink line", () => {
    const path = makePath({
      hops: [
        { file: abs("test/fixtures/reporter/route.ts"), fn: "routeHandler", line: 7 },
        { file: abs("test/fixtures/reporter/service.ts"), fn: "getFiles", line: 3 },
        { file: abs("test/fixtures/reporter/repo.ts"), fn: "fetchFiles", line: 1 }
      ],
      sink: {
        file: abs("test/fixtures/reporter/repo.ts"),
        line: 2,
        model: "file",
        operation: "findMany"
      }
    });

    const lines = captureLines(() => reportPaths([path], { verbose: true }));

    expect(lines.some((l) => l.includes("GET /files"))).toBe(true);
    expect(lines.some((l) => l.includes("routeHandler"))).toBe(true);
    expect(lines.some((l) => l.includes("→") && l.includes("getFiles"))).toBe(true);
    expect(lines.some((l) => l.includes("→") && l.includes("fetchFiles"))).toBe(true);
    expect(lines.some((l) => l.includes("↳") && l.includes("prisma.file.findMany"))).toBe(true);
    expect(lines.every((l) => !l.includes("no DB access found"))).toBe(true);
  });

  it("path with sink: null shows no DB access found and no sink line", () => {
    const path = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 6,
        httpMethod: "get",
        routePath: "/health",
        handlerNode: undefined as any
      },
      hops: [
        { file: abs("test/fixtures/reporter/route.ts"), fn: "routeHandler", line: 6 },
        { file: abs("test/fixtures/reporter/service.ts"), fn: "healthCheck", line: 1 }
      ],
      sink: null
    });

    const lines = captureLines(() => reportPaths([path], { verbose: true }));

    expect(lines.some((l) => l.includes("GET /health"))).toBe(true);
    expect(lines.some((l) => l.includes("no DB access found"))).toBe(true);
    expect(lines.every((l) => !l.includes("↳"))).toBe(true);
  });

  it("unresolved first hop shows ? unresolved inline on that hop", () => {
    const path = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 5,
        httpMethod: "get",
        routePath: "/dynamic",
        handlerNode: undefined as any
      },
      hops: [
        {
          file: abs("test/fixtures/reporter/route.ts"),
          fn: "routeHandler",
          line: 5,
          unresolved: true,
          reason: "dynamic"
        }
      ],
      sink: null,
      hasUnresolvedHops: true
    });

    const lines = captureLines(() => reportPaths([path], { verbose: true }));

    expect(lines.some((l) => l.includes("GET /dynamic"))).toBe(true);
    expect(lines.some((l) => l.includes("? unresolved"))).toBe(true);
    expect(lines.some((l) => l.includes("dynamic"))).toBe(true);
    expect(lines.some((l) => l.includes("no DB access found"))).toBe(true);
  });

  it("unresolved intermediate hop shows ? unresolved on that → line", () => {
    const path = makePath({
      hops: [
        { file: abs("test/fixtures/reporter/route.ts"), fn: "routeHandler", line: 7 },
        {
          file: abs("test/fixtures/reporter/repo.ts"),
          fn: "fetchFiles",
          line: 1,
          unresolved: true,
          reason: "unresolved member call: prisma.file.findMany"
        }
      ],
      sink: {
        file: abs("test/fixtures/reporter/repo.ts"),
        line: 1,
        model: "file",
        operation: "findMany"
      },
      hasUnresolvedHops: true
    });

    const lines = captureLines(() => reportPaths([path], { verbose: true }));

    const unresolvedLine = lines.find((l) => l.includes("→") && l.includes("? unresolved"));
    expect(unresolvedLine).toBeTruthy();
    expect(unresolvedLine).toContain("fetchFiles");
    expect(lines.some((l) => l.includes("↳") && l.includes("prisma.file.findMany"))).toBe(true);
  });

  it("groups multiple paths from same route under a single header", () => {
    const makeBranch = (model: string): TracedPath =>
      makePath({
        route: {
          file: abs("test/fixtures/reporter/route.ts"),
          line: 7,
          httpMethod: "post",
          routePath: "/items",
          handlerNode: undefined as any
        },
        hops: [
          { file: abs("test/fixtures/reporter/route.ts"), fn: "routeHandler", line: 7 },
          { file: abs(`test/fixtures/reporter/${model}.ts`), fn: "create", line: 2 }
        ],
        sink: {
          file: abs(`test/fixtures/reporter/${model}.ts`),
          line: 3,
          model,
          operation: "create"
        }
      });

    const lines = captureLines(() => reportPaths([makeBranch("user"), makeBranch("item")], { verbose: true }));

    const headerLines = lines.filter((l) => l.includes("POST /items"));
    expect(headerLines.length).toBe(1);
    expect(lines.some((l) => l.includes("prisma.user.create"))).toBe(true);
    expect(lines.some((l) => l.includes("prisma.item.create"))).toBe(true);
  });

  it("keeps routes with different methods separate even if path matches", () => {
    const get = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 5,
        httpMethod: "get",
        routePath: "/items",
        handlerNode: undefined as any
      },
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "listItems", line: 5 }],
      sink: null
    });

    const post = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 10,
        httpMethod: "post",
        routePath: "/items",
        handlerNode: undefined as any
      },
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "createItem", line: 10 }],
      sink: null
    });

    const lines = captureLines(() => reportPaths([get, post], { verbose: true }));

    expect(lines.some((l) => l.includes("GET /items"))).toBe(true);
    expect(lines.some((l) => l.includes("POST /items"))).toBe(true);
  });

  it("hasUnresolvedHops: true with a sink still shows the sink", () => {
    const path = makePath({
      hops: [
        { file: abs("test/fixtures/reporter/route.ts"), fn: "routeHandler", line: 7 },
        {
          file: abs("test/fixtures/reporter/repo.ts"),
          fn: "fetchFiles",
          line: 1,
          unresolved: true,
          reason: "dynamic"
        }
      ],
      sink: {
        file: abs("test/fixtures/reporter/repo.ts"),
        line: 1,
        model: "user",
        operation: "findFirst"
      },
      hasUnresolvedHops: true
    });

    const lines = captureLines(() => reportPaths([path], { verbose: true }));

    expect(lines.some((l) => l.includes("↳") && l.includes("prisma.user.findFirst"))).toBe(true);
    expect(lines.every((l) => !l.includes("no DB access found"))).toBe(true);
  });

  it("prints summary and truncates route paths when limits are set", () => {
    const previous = process.env.QUERYAWARE_MAX_PATHS_PER_ROUTE;
    process.env.QUERYAWARE_MAX_PATHS_PER_ROUTE = "1";

    const branchA = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 7,
        httpMethod: "get",
        routePath: "/bulk",
        handlerNode: undefined as any
      },
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "a", line: 7 }],
      sink: null
    });

    const branchB = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 8,
        httpMethod: "get",
        routePath: "/bulk",
        handlerNode: undefined as any
      },
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "b", line: 8 }],
      sink: null
    });

    const lines = captureLines(() => reportPaths([branchA, branchB], { verbose: true }));

    if (previous === undefined) {
      delete process.env.QUERYAWARE_MAX_PATHS_PER_ROUTE;
    } else {
      process.env.QUERYAWARE_MAX_PATHS_PER_ROUTE = previous;
    }

    expect(lines.some((l) => l.includes("summary: routes="))).toBe(true);
    expect(lines.some((l) => l.includes("path 1/2"))).toBe(true);
    expect(lines.some((l) => l.includes("more paths omitted for this route"))).toBe(true);
  });

  it("truncates long hop chains when hop limit is set", () => {
    const previous = process.env.QUERYAWARE_MAX_HOPS_PER_PATH;
    process.env.QUERYAWARE_MAX_HOPS_PER_PATH = "2";

    const path = makePath({
      hops: [
        { file: abs("test/fixtures/reporter/route.ts"), fn: "h1", line: 1 },
        { file: abs("test/fixtures/reporter/route.ts"), fn: "h2", line: 2 },
        { file: abs("test/fixtures/reporter/route.ts"), fn: "h3", line: 3 }
      ],
      sink: null
    });

    const lines = captureLines(() => reportPaths([path], { verbose: true }));

    if (previous === undefined) {
      delete process.env.QUERYAWARE_MAX_HOPS_PER_PATH;
    } else {
      process.env.QUERYAWARE_MAX_HOPS_PER_PATH = previous;
    }

    expect(lines.some((l) => l.includes("h1"))).toBe(true);
    expect(lines.some((l) => l.includes("h2"))).toBe(true);
    expect(lines.every((l) => !l.includes("h3"))).toBe(true);
    expect(lines.some((l) => l.includes("hops omitted"))).toBe(true);
  });

  it("default mode shows only DB access files", () => {
    const withSink = makePath({
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "routeHandler", line: 7 }],
      sink: {
        file: abs("test/fixtures/reporter/repo.ts"),
        line: 2,
        model: "file",
        operation: "findMany"
      }
    });
    const noSink = makePath({
      route: {
        file: abs("test/fixtures/reporter/route.ts"),
        line: 6,
        httpMethod: "get",
        routePath: "/health",
        handlerNode: undefined as any
      },
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "health", line: 6 }],
      sink: null
    });

    const lines = captureLines(() => reportPaths([withSink, noSink]));

    expect(lines.some((l) => l.includes("DB access: 1 file"))).toBe(true);
    expect(lines.some((l) => l.includes("routes traced:"))).toBe(true);
    expect(lines.some((l) => l.includes("--verbose"))).toBe(true);
    expect(lines.every((l) => !l.includes("repo.ts"))).toBe(true);
    expect(lines.every((l) => !l.includes("GET /files"))).toBe(true);
    expect(lines.every((l) => !l.includes("no DB access found"))).toBe(true);
  });

  it("default mode shows no-DB-access message when no sinks exist", () => {
    const noSink = makePath({
      hops: [{ file: abs("test/fixtures/reporter/route.ts"), fn: "health", line: 6 }],
      sink: null
    });

    const lines = captureLines(() => reportPaths([noSink]));

    expect(lines.some((l) => l.includes("DB access: 0"))).toBe(true);
  });
});
