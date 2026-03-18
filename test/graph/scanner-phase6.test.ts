import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanTarget } from "../../src/scanner.js";

const fixturesRoot = resolve(process.cwd(), "test/fixtures/scanner-integration");

describe("scanTarget Phase 6 integration", () => {
  it("runs static + graph pipelines by default", { timeout: 30000 }, () => {
    const fixtureDir = resolve(fixturesRoot, "mixed-static-and-graph");
    const result = scanTarget(fixtureDir);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.type === "n-plus-one")).toBe(true);
    expect(result.issues.some((issue) => issue.type === "unscoped-query")).toBe(true);

    expect(Array.isArray(result.paths)).toBe(true);
    expect(result.paths?.length).toBeGreaterThan(0);

    const sinkPath = result.paths?.find(
      (path) => path.route.routePath === "/files" && path.sink?.model === "file" && path.sink.operation === "findMany"
    );

    expect(sinkPath).toBeTruthy();
  });

  it("supports skipGraph without changing static detection", () => {
    const fixtureDir = resolve(fixturesRoot, "mixed-static-and-graph");
    const result = scanTarget(fixtureDir, { skipGraph: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.paths).toBeUndefined();
  });

  it("supports skipStatic while still tracing graph paths", () => {
    const fixtureDir = resolve(fixturesRoot, "mixed-static-and-graph");
    const result = scanTarget(fixtureDir, { skipStatic: true });

    expect(result.issues).toEqual([]);
    expect(Array.isArray(result.paths)).toBe(true);
    expect(result.paths?.some((path) => path.route.routePath === "/files")).toBe(true);
  });

  it("returns empty traced paths when graph is enabled but no routes are found", () => {
    const fixtureDir = resolve(fixturesRoot, "no-routes");
    const result = scanTarget(fixtureDir);

    expect(Array.isArray(result.paths)).toBe(true);
    expect(result.paths).toEqual([]);
  });

  it("supports skipping both static and graph pipelines", () => {
    const fixtureDir = resolve(fixturesRoot, "mixed-static-and-graph");
    const result = scanTarget(fixtureDir, { skipStatic: true, skipGraph: true });

    expect(result.issues).toEqual([]);
    expect(result.paths).toBeUndefined();
  });
});
