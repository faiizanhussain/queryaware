import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "glob";
import { detectNPlusOne } from "./detectors/n-plus-one.js";
import { detectRawSqlIssues } from "./detectors/raw-sql.js";
import { detectSequentialWrites } from "./detectors/sequential-writes.js";
import { detectUnscopedQuery } from "./detectors/unscoped-query.js";
import { buildCallGraph } from "./graph/call-graph-builder.js";
import { loadProject } from "./graph/project-loader.js";
import { tracePaths } from "./graph/path-tracer.js";
import { findRouteEntries } from "./graph/route-finder.js";
import { findPrismaSinks } from "./graph/sink-detector.js";
import type { TracedPath } from "./graph/types.js";

export type IssueType =
  | "n-plus-one"
  | "unscoped-query"
  | "sequential-writes"
  | "unsafe-raw-query"
  | "prisma-raw-fragment"
  | "raw-select-star"
  | "raw-unscoped-delete"
  | "raw-unscoped-update";

export interface ScanIssue {
  type: IssueType;
  file: string;
  line: number;
  call: string;
}

export interface ScanResult {
  issues: ScanIssue[];
  paths?: TracedPath[];
}

export interface ScanOptions {
  skipGraph?: boolean;
  skipStatic?: boolean;
}

export function scanTarget(targetPath: string, options: ScanOptions = {}): ScanResult {
  const absoluteTarget = resolve(targetPath);
  const files = globSync("**/*.{ts,tsx,js,jsx}", {
    cwd: absoluteTarget,
    absolute: true,
    nodir: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]
  });

  const issues: ScanIssue[] = [];

  if (!options.skipStatic) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split(/\r?\n/);

      const nPlusOneIssues = detectNPlusOne(lines);
      for (const issue of nPlusOneIssues) {
        issues.push({
          type: "n-plus-one",
          file,
          line: issue.line,
          call: issue.call
        });
      }

      const unscopedIssues = detectUnscopedQuery(lines);
      for (const issue of unscopedIssues) {
        issues.push({
          type: "unscoped-query",
          file,
          line: issue.line,
          call: issue.call
        });
      }

      const sequentialWriteIssues = detectSequentialWrites(lines);
      for (const issue of sequentialWriteIssues) {
        issues.push({
          type: "sequential-writes",
          file,
          line: issue.line,
          call: issue.call
        });
      }

      const rawSqlIssues = detectRawSqlIssues(lines);
      for (const issue of rawSqlIssues) {
        issues.push({
          type: issue.type,
          file,
          line: issue.line,
          call: issue.call
        });
      }
    }
  }

  if (options.skipGraph) {
    return { issues };
  }

  const project = loadProject(absoluteTarget);
  const routes = findRouteEntries(project);
  const graph = buildCallGraph(project);
  const sinks = findPrismaSinks(project);
  const paths = tracePaths(routes, graph, sinks);

  return { issues, paths };
}