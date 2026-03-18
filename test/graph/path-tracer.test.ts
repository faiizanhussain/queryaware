import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCallGraph } from "../../src/graph/call-graph-builder.js";
import { findRouteEntries } from "../../src/graph/route-finder.js";
import { loadProject } from "../../src/graph/project-loader.js";
import { findPrismaSinks } from "../../src/graph/sink-detector.js";
import { tracePaths } from "../../src/graph/path-tracer.js";
import type { TracedPath } from "../../src/graph/types.js";

interface ExpectedHop {
  file: string;
  fn: string;
  line: number;
  unresolved?: boolean;
  reasonContains?: string;
}

interface ExpectedSink {
  file: string;
  model: string;
  operation: string;
}

interface ExpectedPath {
  routeFile: string;
  routeMethod: string;
  routePath: string;
  hops: ExpectedHop[];
  sink: ExpectedSink | null;
  hasUnresolvedHops: boolean;
}

interface FixtureContract {
  paths: ExpectedPath[];
}

interface ComparableHop {
  file: string;
  fn: string;
  line: number;
  unresolved: boolean;
  reason: string;
}

interface ComparablePath {
  routeFile: string;
  routeMethod: string;
  routePath: string;
  hops: ComparableHop[];
  sink: ExpectedSink | null;
  hasUnresolvedHops: boolean;
}

const fixturesRoot = resolve(process.cwd(), "test/fixtures/path-tracer");

const fixtureNames = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

describe("tracePaths fixture matrix", () => {
  for (const fixtureName of fixtureNames) {
    it(`${fixtureName} matches expected traced paths and snapshot`, () => {
      const fixtureDir = resolve(fixturesRoot, fixtureName);
      const expected = readJson<FixtureContract>(resolve(fixtureDir, "expected-paths.json"));
      const snapshot = readJson<string[]>(resolve(fixtureDir, "paths.snapshot.json"));

      const project = loadProject(fixtureDir);

      let traced: TracedPath[];
      try {
        const entries = findRouteEntries(project);
        const graph = buildCallGraph(project);
        const sinks = findPrismaSinks(project);
        traced = tracePaths(entries, graph, sinks);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`tracePaths pipeline threw for fixture '${fixtureName}': ${message}`);
      }

      const actualPaths = normalizePaths(traced, fixtureDir);
      const expectedPaths = normalizeExpectedPaths(expected.paths);

      expect(toComparableTuples(actualPaths)).toEqual(toComparableTuples(expectedPaths));
      assertExpectedReasonContains(actualPaths, expectedPaths, fixtureName);
      expect(toSnapshotLines(actualPaths)).toEqual(snapshot);
    });
  }
});

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function normalizePaths(paths: TracedPath[], fixtureDir: string): ComparablePath[] {
  return paths
    .map((path) => ({
      routeFile: normalizeFileName(path.route.file, fixtureDir),
      routeMethod: path.route.httpMethod,
      routePath: path.route.routePath,
      hops: path.hops.map((hop) => ({
        file: normalizeFileName(hop.file, fixtureDir),
        fn: hop.fn,
        line: hop.line,
        unresolved: hop.unresolved === true,
        reason: hop.reason ?? ""
      })),
      sink: path.sink
        ? {
            file: normalizeFileName(path.sink.file, fixtureDir),
            model: path.sink.model,
            operation: path.sink.operation
          }
        : null,
      hasUnresolvedHops: path.hasUnresolvedHops
    }))
    .sort(comparePaths);
}

function normalizeExpectedPaths(paths: ExpectedPath[]): ComparablePath[] {
  return paths
    .map((path) => ({
      routeFile: path.routeFile,
      routeMethod: path.routeMethod,
      routePath: path.routePath,
      hops: path.hops.map((hop) => ({
        file: hop.file,
        fn: hop.fn,
        line: hop.line,
        unresolved: hop.unresolved === true,
        reason: hop.reasonContains ?? ""
      })),
      sink: path.sink,
      hasUnresolvedHops: path.hasUnresolvedHops
    }))
    .sort(comparePaths);
}

function toComparableTuples(paths: ComparablePath[]): string[] {
  return paths.map((path) => {
    const hops = path.hops
      .map((hop) => {
        const unresolved = hop.unresolved ? " ?" : "";
        return `${hop.file}#${hop.fn}:${hop.line}${unresolved}`;
      })
      .join(" -> ");

    const sink = path.sink ? `${path.sink.file} prisma.${path.sink.model}.${path.sink.operation}` : "no-sink";

    return `${path.routeMethod.toUpperCase()} ${path.routePath} (${path.routeFile}) | ${hops} | ${sink} | unresolved=${path.hasUnresolvedHops}`;
  });
}

function assertExpectedReasonContains(
  actual: ComparablePath[],
  expected: ComparablePath[],
  fixtureName: string
): void {
  for (const expectedPath of expected) {
    const actualPath = actual.find((candidate) => comparePaths(candidate, expectedPath) === 0);
    expect(actualPath, `Missing expected path for fixture '${fixtureName}'`).toBeTruthy();

    if (!actualPath) {
      continue;
    }

    for (let index = 0; index < expectedPath.hops.length; index += 1) {
      const expectedHop = expectedPath.hops[index];
      if (!expectedHop.unresolved || expectedHop.reason.trim().length === 0) {
        continue;
      }

      const actualHop = actualPath.hops[index];
      expect(
        actualHop.reason.toLowerCase(),
        `Fixture '${fixtureName}' unresolved reason mismatch for hop ${expectedHop.file}#${expectedHop.fn}`
      ).toContain(expectedHop.reason.toLowerCase());
    }
  }
}

function toSnapshotLines(paths: ComparablePath[]): string[] {
  return paths.map((path) => {
    const route = `${path.routeMethod.toUpperCase()} ${path.routePath}`;
    const hops = path.hops
      .map((hop) => {
        const unresolved = hop.unresolved ? ` unresolved(${hop.reason || "unknown"})` : "";
        return `${hop.file}#${hop.fn}:${hop.line}${unresolved}`;
      })
      .join(" -> ");

    const sink = path.sink ? `prisma.${path.sink.model}.${path.sink.operation}@${path.sink.file}` : "no-sink";
    return `${route} | ${hops} | ${sink}`;
  });
}

function normalizeFileName(filePath: string, fixtureDir: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const normalizedFixture = fixtureDir.replaceAll("\\", "/");
  const prefix = `${normalizedFixture}/`;

  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  return basename(normalizedPath);
}

function comparePaths(a: ComparablePath, b: ComparablePath): number {
  const left = `${a.routeMethod}:${a.routePath}:${a.routeFile}:${a.hops
    .map((hop) => `${hop.file}#${hop.fn}:${hop.line}:${hop.unresolved ? "1" : "0"}`)
    .join("->")}:${a.sink ? `${a.sink.file}:${a.sink.model}:${a.sink.operation}` : "no-sink"}:${
    a.hasUnresolvedHops ? "1" : "0"
  }`;

  const right = `${b.routeMethod}:${b.routePath}:${b.routeFile}:${b.hops
    .map((hop) => `${hop.file}#${hop.fn}:${hop.line}:${hop.unresolved ? "1" : "0"}`)
    .join("->")}:${b.sink ? `${b.sink.file}:${b.sink.model}:${b.sink.operation}` : "no-sink"}:${
    b.hasUnresolvedHops ? "1" : "0"
  }`;

  return left.localeCompare(right);
}
