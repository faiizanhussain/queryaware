import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProject } from "../../src/graph/project-loader.js";
import { findPrismaSinks } from "../../src/graph/sink-detector.js";
import type { SinkNode } from "../../src/graph/types.js";

interface ExpectedSink {
  file: string;
  model: string;
  operation: string;
}

interface FixtureContract {
  sinks: ExpectedSink[];
}

interface ComparableSink {
  file: string;
  model: string;
  operation: string;
}

const fixturesRoot = resolve(process.cwd(), "test/fixtures/sink-detector");

const fixtureNames = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

describe("findPrismaSinks fixture matrix", () => {
  for (const fixtureName of fixtureNames) {
    it(`${fixtureName} matches expected sinks and snapshot`, () => {
      const fixtureDir = resolve(fixturesRoot, fixtureName);
      const expected = readJson<FixtureContract>(resolve(fixtureDir, "expected-sinks.json"));
      const snapshot = readJson<string[]>(resolve(fixtureDir, "sinks.snapshot.json"));

      const project = loadProject(fixtureDir);

      let sinks;
      try {
        sinks = findPrismaSinks(project);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`findPrismaSinks threw for fixture '${fixtureName}': ${message}`);
      }

      const actualSinks = normalizeSinks(sinks, fixtureDir);
      const expectedSinks = normalizeExpected(expected.sinks);

      expect(actualSinks).toEqual(expectedSinks);
      expect(toSnapshotLines(actualSinks)).toEqual(snapshot);
    });
  }
});

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function normalizeSinks(sinks: SinkNode[], fixtureDir: string): ComparableSink[] {
  return sinks
    .map((sink) => ({
      file: normalizeFileName(sink.file, fixtureDir),
      model: sink.model,
      operation: sink.operation
    }))
    .sort(compareSinks);
}

function normalizeExpected(sinks: ExpectedSink[]): ComparableSink[] {
  return sinks
    .map((sink) => ({
      file: sink.file,
      model: sink.model,
      operation: sink.operation
    }))
    .sort(compareSinks);
}

function toSnapshotLines(sinks: ComparableSink[]): string[] {
  return sinks.map((sink) => `${sink.file} prisma.${sink.model}.${sink.operation}`);
}

function compareSinks(a: ComparableSink, b: ComparableSink): number {
  return `${a.file}:${a.model}:${a.operation}`.localeCompare(`${b.file}:${b.model}:${b.operation}`);
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