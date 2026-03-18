import { relative } from "node:path";
import chalk from "chalk";
import type { ScanIssue } from "./scanner.js";
import type { TracedPath } from "./graph/types.js";

const divider = "─────────────────────────────────────────";
const DEFAULT_MAX_ROUTES = 50;
const DEFAULT_MAX_PATHS_PER_ROUTE = 5;
const DEFAULT_MAX_HOPS_PER_PATH = 8;

const ISSUE_LABEL: Record<string, string> = {
  "n-plus-one":          "N+1 Query",
  "unscoped-query":      "Unscoped findMany",
  "sequential-writes":   "Sequential writes",
  "unsafe-raw-query":    "Unsafe raw query",
  "prisma-raw-fragment": "Prisma.raw fragment",
  "raw-select-star":     "Raw SELECT *",
  "raw-unscoped-delete": "DELETE without WHERE",
  "raw-unscoped-update": "UPDATE without WHERE"
};

const ISSUE_SEVERITY: Record<string, "High" | "Medium"> = {
  "n-plus-one":          "High",
  "unscoped-query":      "High",
  "sequential-writes":   "Medium",
  "unsafe-raw-query":    "High",
  "prisma-raw-fragment": "Medium",
  "raw-select-star":     "Medium",
  "raw-unscoped-delete": "High",
  "raw-unscoped-update": "High"
};

const ISSUE_DETAIL: Record<string, { impact: string; fix?: string }> = {
  "n-plus-one":          { impact: "query explosion causes latency spikes and DB load growth", fix: "use findMany({ where: { id: { in: ids } } })" },
  "unscoped-query":      { impact: "full table scan + data leak risk in multi-tenant setup" },
  "sequential-writes":   { impact: "N writes in series increase lock time and reduce throughput", fix: "batch with createMany/updateMany or a transaction" },
  "unsafe-raw-query":    { impact: "SQL injection risk — user input reaches the database unescaped", fix: "use $queryRaw/$executeRaw with Prisma.sql bound variables" },
  "prisma-raw-fragment": { impact: "verbatim injection can break parameterization boundaries", fix: "replace Prisma.raw(...) with safe ${variable} inside Prisma.sql" },
  "raw-select-star":     { impact: "over-fetching increases payload size and may expose sensitive columns", fix: "list only required columns in the SELECT clause" },
  "raw-unscoped-delete": { impact: "accidental full-table deletion — irreversible without a backup", fix: "add a restrictive WHERE clause or use a soft-delete strategy" },
  "raw-unscoped-update": { impact: "accidental full-table mutation — every row is overwritten", fix: "add a restrictive WHERE clause" }
};

export interface ReportPathsOptions {
  verbose?: boolean;
}

function severityBadge(sev: "High" | "Medium"): string {
  return sev === "High" ? chalk.red(`[${sev}]`) : chalk.yellow(`[${sev}]`);
}

export function reportPaths(paths: TracedPath[], options: ReportPathsOptions = {}): void {
  if (!options.verbose) {
    reportDbAccessFiles(paths);
    return;
  }

  reportVerbosePaths(paths);
}

function reportVerbosePaths(paths: TracedPath[]): void {
  console.log("queryaware path analysis");
  console.log(divider);

  if (paths.length === 0) {
    console.log("  No routes found.");
    return;
  }

  const byRoute = new Map<string, TracedPath[]>();

  for (const tracedPath of paths) {
    const key = `${tracedPath.route.httpMethod.toUpperCase()} ${tracedPath.route.routePath}`;
    const group = byRoute.get(key) ?? [];
    group.push(tracedPath);
    byRoute.set(key, group);
  }

  const routeEntries = [...byRoute.entries()].sort(([a], [b]) => a.localeCompare(b));
  const totalRoutes = routeEntries.length;
  const unresolvedPaths = paths.filter((p) => p.hasUnresolvedHops).length;
  const sinkPaths = paths.filter((p) => p.sink !== null).length;
  const noSinkPaths = paths.length - sinkPaths;

  const maxRoutes = readPositiveInt("QUERYAWARE_MAX_ROUTES", DEFAULT_MAX_ROUTES);
  const maxPathsPerRoute = readPositiveInt("QUERYAWARE_MAX_PATHS_PER_ROUTE", DEFAULT_MAX_PATHS_PER_ROUTE);
  const maxHopsPerPath = readPositiveInt("QUERYAWARE_MAX_HOPS_PER_PATH", DEFAULT_MAX_HOPS_PER_PATH);

  console.log(
    chalk.dim(
      `summary: routes=${totalRoutes} paths=${paths.length} sinks=${sinkPaths} no-sink=${noSinkPaths} unresolved=${unresolvedPaths}`
    )
  );
  console.log(chalk.dim(`display limits: routes=${maxRoutes}, paths/route=${maxPathsPerRoute}, hops/path=${maxHopsPerPath}`));
  console.log("");

  const displayedRoutes = routeEntries.slice(0, maxRoutes);

  if (displayedRoutes.length < routeEntries.length) {
    console.log(chalk.yellow(`showing ${displayedRoutes.length}/${routeEntries.length} routes`));
    console.log("");
  }

  for (const [routeIndex, [routeKey, routePaths]] of displayedRoutes.entries()) {
    const unresolvedInRoute = routePaths.filter((p) => p.hasUnresolvedHops).length;
    const sinksInRoute = routePaths.filter((p) => p.sink !== null).length;
    console.log(chalk.bold(`[${routeIndex + 1}/${displayedRoutes.length}] ${routeKey}`));
    console.log(chalk.dim(`  paths=${routePaths.length} sinks=${sinksInRoute} unresolved=${unresolvedInRoute}`));

    const displayedPaths = routePaths.slice(0, maxPathsPerRoute);

    for (const [pathIndex, tracedPath] of displayedPaths.entries()) {
      console.log(chalk.dim(`  path ${pathIndex + 1}/${routePaths.length}`));
      const [firstHop, ...remainingHops] = tracedPath.hops;
      const allHops = [firstHop, ...remainingHops].filter((h): h is NonNullable<typeof h> => Boolean(h));
      const displayedHops = allHops.slice(0, maxHopsPerPath);

      for (const [hopIndex, hop] of displayedHops.entries()) {
        const relFile = relative(process.cwd(), hop.file).replace(/\\/g, "/");
        const unresolvedSuffix = hop.unresolved
          ? chalk.dim(`  ? unresolved (${hop.reason ?? "dynamic dispatch"})`)
          : "";
        const arrow = hopIndex === 0 ? "  " : "  → ";
        console.log(`${arrow}${relFile}#${hop.fn}:${hop.line}${unresolvedSuffix}`);
      }

      if (displayedHops.length < allHops.length) {
        console.log(chalk.dim(`  … ${allHops.length - displayedHops.length} hops omitted`));
      }

      if (tracedPath.sink) {
        const relSinkFile = relative(process.cwd(), tracedPath.sink.file).replace(/\\/g, "/");
        console.log(
          `  ${chalk.green("↳")} prisma.${tracedPath.sink.model}.${tracedPath.sink.operation}  ${relSinkFile}`
        );
      } else {
        console.log(`  ${chalk.blue("ℹ")} no DB access found`);
      }

      console.log("");
    }

    if (displayedPaths.length < routePaths.length) {
      console.log(chalk.dim(`  … ${routePaths.length - displayedPaths.length} more paths omitted for this route`));
      console.log("");
    }
  }

  console.log(divider);
}

function reportDbAccessFiles(paths: TracedPath[]): void {
  console.log("queryaware path analysis");
  console.log(divider);

  if (paths.length === 0) {
    console.log("  No routes found.");
    return;
  }

  const sinkPaths = paths.filter((path) => path.sink !== null);
  const totalRoutes = new Set(paths.map((p) => `${p.route.httpMethod} ${p.route.routePath}`)).size;

  if (sinkPaths.length === 0) {
    console.log(chalk.dim(`  routes traced: ${totalRoutes}  •  DB access: 0`));
    console.log(divider);
    return;
  }

  const byFile = new Map<string, Set<string>>();
  const byOperation = new Map<string, number>();

  for (const path of sinkPaths) {
    const sink = path.sink!;
    const relFile = relative(process.cwd(), sink.file).replace(/\\/g, "/");
    const op = `prisma.${sink.model}.${sink.operation}`;
    byFile.set(relFile, (byFile.get(relFile) ?? new Set()).add(op));
    byOperation.set(op, (byOperation.get(op) ?? 0) + 1);
  }

  const topOps = [...byOperation.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([op]) => op)
    .join(", ");

  const fileCount = byFile.size;
  console.log(chalk.dim(`  routes traced: ${totalRoutes}  •  DB access: ${fileCount} file${fileCount !== 1 ? "s" : ""}`));
  console.log(chalk.dim(`  top operations: ${topOps}`));
  console.log("");
  console.log(chalk.dim("  run with --verbose to see the full file list and call paths"));
  console.log(divider);
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

export function reportIssues(issues: ScanIssue[]): number {
  console.log("queryaware scan results");
  console.log(divider);

  if (issues.length === 0) {
    console.log(chalk.green("✔ No issues found."));
    console.log("");
    return 0;
  }

  const byFile = new Map<string, ScanIssue[]>();
  for (const issue of issues) {
    const rel = relative(process.cwd(), issue.file).replace(/\\/g, "/");
    const list = byFile.get(rel) ?? [];
    list.push(issue);
    byFile.set(rel, list);
  }

  const highCount = issues.filter((i) => ISSUE_SEVERITY[i.type] === "High").length;
  const medCount = issues.length - highCount;

  console.log(chalk.dim(`  ${issues.length} issue${issues.length !== 1 ? "s" : ""} in ${byFile.size} file${byFile.size !== 1 ? "s" : ""}  ·  High: ${highCount}  Medium: ${medCount}`));
  console.log("");

  for (const [file, fileIssues] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(chalk.underline(file) + chalk.dim(`  (${fileIssues.length})`));
    for (const issue of fileIssues) {
      const sev = ISSUE_SEVERITY[issue.type] ?? "Medium";
      const label = ISSUE_LABEL[issue.type] ?? issue.type;
      const detail = ISSUE_DETAIL[issue.type];
      console.log(`  ${chalk.red("✖")} ${label}  ${chalk.dim(`:${issue.line}`)}  ${chalk.dim(issue.call)}  ${severityBadge(sev)}`);
      if (detail?.impact) console.log(chalk.dim(`     Impact: ${detail.impact}`));
      if (detail?.fix)    console.log(chalk.dim(`     Fix:    ${detail.fix}`));
    }
    console.log("");
  }

  console.log(divider);
  console.log(`${chalk.red(`✖ ${issues.length} issue${issues.length !== 1 ? "s" : ""} found`)}  ${chalk.dim(`High: ${highCount}  Medium: ${medCount}`)}`);
  console.log("");

  return issues.length;
}