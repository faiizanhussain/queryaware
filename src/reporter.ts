import { relative } from "node:path";
import chalk from "chalk";
import type { ScanIssue } from "./scanner.js";

const divider = "─────────────────────────────────────────";

function formatSeverity(severity: string): string {
  if (severity === "High") {
    return chalk.red(severity);
  }

  if (severity === "Medium") {
    return chalk.yellow(severity);
  }

  return chalk.green(severity);
}

function formatIssue(issue: ScanIssue): string[] {
  const relativeFile = relative(process.cwd(), issue.file).replace(/\\/g, "/");

  if (issue.type === "n-plus-one") {
    return [
      chalk.red("✖ N+1 Query Detected"),
      `  ${relativeFile}:${issue.line}`,
      `  ${issue.call} called inside a for loop`,
      `  Severity: ${formatSeverity("High")}`,
      "  Impact: query explosion causes latency spikes and database load growth",
      "  Fix: use findMany({ where: { id: { in: ids } } })"
    ];
  }

  if (issue.type === "unscoped-query") {
    return [
      chalk.red("✖ Unscoped findMany"),
      `  ${relativeFile}:${issue.line}`,
      `  ${issue.call} has no where clause`,
      `  Severity: ${formatSeverity("High")}`,
      "  Impact: full table scan + data leak risk in multi-tenant setup"
    ];
  }

  return [
    chalk.red("✖ Sequential write in loop"),
    `  ${relativeFile}:${issue.line}`,
    `  ${issue.call} called inside a loop`,
    `  Severity: ${formatSeverity("Medium")}`,
    "  Impact: N writes in series increase lock time and reduce throughput",
    "  Fix: batch writes with createMany/updateMany or transaction strategy"
  ];
}

export function reportIssues(issues: ScanIssue[]): number {
  console.log("queryaware scan results");
  console.log(divider);

  if (issues.length === 0) {
    console.log(chalk.green("✔ No issues found."));
    return 0;
  }

  for (const issue of issues) {
    const formatted = formatIssue(issue);
    for (const line of formatted) {
      console.log(line);
    }
    console.log("");
  }

  console.log(divider);
  console.log(chalk.red(`${issues.length} errors found. Commit blocked.`));

  return issues.length;
}