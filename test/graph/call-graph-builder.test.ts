import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProject } from "../../src/graph/project-loader.js";
import { buildCallGraph } from "../../src/graph/call-graph-builder.js";
import type { CallEdge } from "../../src/graph/types.js";

interface ExpectedNode {
  file: string;
  symbol: string;
}

interface ExpectedEdge {
  from: ExpectedNode;
  to: ExpectedNode | null;
  unresolved?: boolean;
  reasonContains?: string;
}

interface FixtureContract {
  edges: ExpectedEdge[];
}

interface ComparableEdge {
  fromFile: string;
  fromSymbol: string;
  toFile: string | null;
  toSymbol: string | null;
  unresolved: boolean;
  reason: string;
}

const fixturesRoot = resolve(process.cwd(), "test/fixtures/call-graph");

const fixtureNames = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

describe("buildCallGraph fixture matrix", () => {
  for (const fixtureName of fixtureNames) {
    it(`${fixtureName} matches expected edges and snapshot`, () => {
      const fixtureDir = resolve(fixturesRoot, fixtureName);
      const expected = readJson<FixtureContract>(resolve(fixtureDir, "expected-edges.json"));
      const snapshot = readJson<string[]>(resolve(fixtureDir, "edges.snapshot.json"));

      const project = loadProject(fixtureDir);

      let graph;
      try {
        graph = buildCallGraph(project);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`buildCallGraph threw for fixture '${fixtureName}': ${message}`);
      }

      const actualEdges = flattenGraphEdges(Array.from(graph.values()).flat(), fixtureDir);
      const expectedEdges = expected.edges.map((edge) => normalizeExpectedEdge(edge));
      const diagnostics = buildDiagnostics(actualEdges, project.getSourceFiles().map((file) => file.getFilePath()), fixtureDir);

      expect(actualEdges.length, `${fixtureName} edge count mismatch\n${diagnostics}`).toBe(expectedEdges.length);
      expect(toComparableTuples(actualEdges), diagnostics).toEqual(toComparableTuples(expectedEdges));
      assertExpectedReasonContains(actualEdges, expectedEdges, fixtureName, diagnostics);
      assertUnresolvedReasons(actualEdges, fixtureName, diagnostics);
      assertNoDuplicateEdges(actualEdges, fixtureName, diagnostics);

      const actualSnapshot = toSnapshotLines(actualEdges);
      expect(actualSnapshot).toEqual(snapshot);
    });
  }
});

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function flattenGraphEdges(edges: CallEdge[], fixtureDir: string): ComparableEdge[] {
  return edges
    .map((edge) => ({
      fromFile: normalizeFileName(edge.from.file, fixtureDir),
      fromSymbol: edge.from.fn,
      toFile: edge.to ? normalizeFileName(edge.to.file, fixtureDir) : null,
      toSymbol: edge.to ? edge.to.fn : null,
      unresolved: edge.unresolved === true,
      reason: edge.reason ?? ""
    }))
    .sort(compareEdges);
}

function normalizeExpectedEdge(edge: ExpectedEdge): ComparableEdge {
  return {
    fromFile: edge.from.file,
    fromSymbol: edge.from.symbol,
    toFile: edge.to?.file ?? null,
    toSymbol: edge.to?.symbol ?? null,
    unresolved: edge.unresolved === true,
    reason: edge.reasonContains ?? ""
  };
}

function toComparableTuples(edges: ComparableEdge[]): string[] {
  return edges
    .map((edge) => {
      const left = `${edge.fromFile}#${edge.fromSymbol}`;
      const right = edge.toFile && edge.toSymbol ? `${edge.toFile}#${edge.toSymbol}` : "?";
      const unresolvedPart = edge.unresolved ? " unresolved" : "";
      const reasonPart = edge.reason ? ` (${edge.reason})` : "";
      return `${left} -> ${right}${unresolvedPart}${reasonPart}`;
    })
    .sort((a, b) => a.localeCompare(b));
}

function assertExpectedReasonContains(
  actualEdges: ComparableEdge[],
  expectedEdges: ComparableEdge[],
  fixtureName: string,
  diagnostics: string
): void {
  const expectedUnresolved = expectedEdges.filter((edge) => edge.unresolved);
  for (const expectedEdge of expectedUnresolved) {
    const matched = actualEdges.find(
      (edge) =>
        edge.fromFile === expectedEdge.fromFile &&
        edge.fromSymbol === expectedEdge.fromSymbol &&
        edge.toFile === expectedEdge.toFile &&
        edge.toSymbol === expectedEdge.toSymbol &&
        edge.unresolved === true
    );

    expect(
      matched,
      `Fixture '${fixtureName}' is missing expected unresolved edge for ${expectedEdge.fromFile}#${expectedEdge.fromSymbol}\n${diagnostics}`
    ).toBeTruthy();

    if (matched && expectedEdge.reason.length > 0) {
      expect(
        matched.reason.toLowerCase(),
        `Fixture '${fixtureName}' unresolved reason mismatch for ${expectedEdge.fromFile}#${expectedEdge.fromSymbol}\n${diagnostics}`
      ).toContain(expectedEdge.reason.toLowerCase());
    }
  }
}

function assertUnresolvedReasons(edges: ComparableEdge[], fixtureName: string, diagnostics: string): void {
  const missingReason = edges.filter((edge) => edge.unresolved && edge.reason.trim().length === 0);
  if (missingReason.length === 0) {
    return;
  }

  const rows = missingReason
    .map((edge) => `${edge.fromFile}:${edge.fromSymbol} -> unresolved reason=<empty>`)
    .join("\n");

  throw new Error(`Fixture '${fixtureName}' has unresolved edges without reason:\n${rows}\n${diagnostics}`);
}

function assertNoDuplicateEdges(edges: ComparableEdge[], fixtureName: string, diagnostics: string): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const edge of edges) {
    const key = `${edge.fromFile}#${edge.fromSymbol}|${edge.toFile ?? "?"}#${edge.toSymbol ?? "?"}`;
    if (seen.has(key)) {
      duplicates.push(key);
      continue;
    }

    seen.add(key);
  }

  if (duplicates.length === 0) {
    return;
  }

  throw new Error(`Fixture '${fixtureName}' has duplicate edges:\n${duplicates.join("\n")}\n${diagnostics}`);
}

function toSnapshotLines(edges: ComparableEdge[]): string[] {
  return edges.map((edge) => {
    const left = `${edge.fromFile}#${edge.fromSymbol}`;
    if (!edge.toFile || !edge.toSymbol) {
      const reason = edge.reason.trim().length > 0 ? edge.reason : "unknown";
      return `${left} -> ? unresolved (${reason})`;
    }

    return `${left} -> ${edge.toFile}#${edge.toSymbol}`;
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

function compareEdges(a: ComparableEdge, b: ComparableEdge): number {
  return `${a.fromFile}:${a.fromSymbol}:${a.toFile ?? ""}:${a.toSymbol ?? ""}`.localeCompare(
    `${b.fromFile}:${b.fromSymbol}:${b.toFile ?? ""}:${b.toSymbol ?? ""}`
  );
}

function buildDiagnostics(edges: ComparableEdge[], sourceFiles: string[], fixtureDir: string): string {
  const unresolvedRows = edges
    .filter((edge) => edge.unresolved)
    .map((edge) => `${edge.fromFile}:${edge.fromSymbol} | reason=${edge.reason || "<empty>"}`);

  const knownSymbols = sourceFiles
    .map((filePath) => normalizeFileName(filePath, fixtureDir))
    .map((name) => `${name}#${name.replace(/\.ts$/i, "")}`)
    .sort((a, b) => a.localeCompare(b));

  const unresolvedTable = unresolvedRows.length > 0 ? unresolvedRows.join("\n") : "<none>";
  const candidatePreview = knownSymbols.slice(0, 10).join(", ");

  return [
    "Diagnostics:",
    `Unresolved edges: ${unresolvedTable}`,
    `Nearest symbol candidates: ${candidatePreview || "<none>"}`
  ].join("\n");
}
