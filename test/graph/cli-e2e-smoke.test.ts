import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let builtForCurrentRun = false;

function ensureBuiltBinary(): string {
  const binaryPath = resolve(process.cwd(), "dist/bin/queryaware.js");

  if (!existsSync(binaryPath) || !builtForCurrentRun) {
    execSync("npm run build", { stdio: "pipe" });
    builtForCurrentRun = true;
  }

  return binaryPath;
}

describe("CLI built-binary smoke", () => {
  beforeAll(() => {
    ensureBuiltBinary();
  }, 20_000);

  it("runs dist binary scan command end-to-end with both skip flags", () => {
    const binaryPath = ensureBuiltBinary();
    const fixtureDir = resolve(process.cwd(), "test/fixtures/scanner-integration/mixed-static-and-graph");

    const result = spawnSync(
      process.execPath,
      [binaryPath, "scan", fixtureDir, "--skip-graph", "--skip-static"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr || "").toBe("");
    expect(result.stdout).toContain("queryaware scan results");
    expect(result.stdout).toContain("No issues found");
    expect(result.stdout).not.toContain("queryaware path analysis");
  });

  it("runs dist binary with --skip-static and shows compact DB-access file output by default", () => {
    const binaryPath = ensureBuiltBinary();
    const fixtureDir = resolve(process.cwd(), "test/fixtures/scanner-integration/mixed-static-and-graph");

    const result = spawnSync(
      process.execPath,
      [binaryPath, "scan", fixtureDir, "--skip-static"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr || "").toBe("");
    expect(result.stdout).toContain("queryaware scan results");
    expect(result.stdout).toContain("No issues found");
    expect(result.stdout).toContain("queryaware path analysis");
    expect(result.stdout).toContain("DB access:");
    expect(result.stdout).toContain("routes traced:");
    expect(result.stdout).toContain("--verbose");
    expect(result.stdout).not.toContain("service.ts");
    expect(result.stdout).not.toContain("GET /files");
  });

  it("runs dist binary with --skip-static --verbose and shows detailed route output", () => {
    const binaryPath = ensureBuiltBinary();
    const fixtureDir = resolve(process.cwd(), "test/fixtures/scanner-integration/mixed-static-and-graph");

    const result = spawnSync(
      process.execPath,
      [binaryPath, "scan", fixtureDir, "--skip-static", "--verbose"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr || "").toBe("");
    expect(result.stdout).toContain("queryaware path analysis");
    expect(result.stdout).toContain("GET /files");
  });
});
