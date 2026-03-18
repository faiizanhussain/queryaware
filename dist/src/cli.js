import { Command } from "commander";
import { setupHuskyPreCommit } from "./husky.js";
import { reportIssues, reportPaths } from "./reporter.js";
import { scanTarget } from "./scanner.js";
export function runCli(argv) {
    const program = new Command();
    program
        .name("queryaware")
        .description("queryaware — static analysis for database query anti-patterns.\n" +
        "Detects N+1 queries, unscoped findMany, sequential writes, unsafe raw SQL,\n" +
        "Prisma.raw injection risks, SELECT *, and unscoped DELETE/UPDATE — all without AI.\n\n" +
        "Examples:\n" +
        "  queryaware scan ./src                  run full analysis\n" +
        "  queryaware scan ./src --verbose        show full call paths and DB access files\n" +
        "  queryaware scan ./src --skip-graph     static checks only (faster)\n" +
        "  queryaware scan ./src --skip-static    call-graph tracing only")
        .version("0.2.0");
    program
        .command("scan")
        .description("Scan a folder for ORM query anti-patterns.\n" +
        "Runs two pipelines in parallel:\n" +
        "  • Static detector  — regex/line-based checks (N+1, unscoped queries, raw SQL issues)\n" +
        "  • Call-graph tracer — traces HTTP routes → services → DB sinks via the TypeScript AST\n\n" +
        "By default, shows a summary of how many files touch the DB.\n" +
        "Use --verbose to see the full file list, call-hop chains, and operation breakdown.")
        .argument("<targetPath>", "Path to the source folder to scan (e.g. ./src)")
        .option("--skip-graph", "Skip the call-graph/AST tracing pipeline (faster for static-only runs)", false)
        .option("--skip-static", "Skip the static regex/line-based detectors (run call-graph tracing only)", false)
        .option("--verbose", "Show full call-hop paths, DB access file list, and per-route operation breakdown", false)
        .option("--fix", "[coming soon] Automatically fix detected issues where safe to do so", false)
        .action((targetPath, options) => {
        const start = Date.now();
        console.log(`queryaware scanning ${targetPath}...`);
        if (!options.skipStatic) {
            console.log("  • static detector: running");
        }
        if (!options.skipGraph) {
            console.log("  • call-graph tracer: running");
        }
        const result = scanTarget(targetPath, {
            skipGraph: options.skipGraph,
            skipStatic: options.skipStatic
        });
        console.log(`scan complete in ${Date.now() - start}ms`);
        const count = reportIssues(result.issues);
        if (result.paths !== undefined) {
            reportPaths(result.paths, { verbose: options.verbose });
        }
        if (options.fix) {
            console.log("--fix is not implemented yet.");
        }
        process.exitCode = count > 0 ? 1 : 0;
    });
    program
        .command("setup-husky")
        .description("Add queryaware to your Husky pre-commit hook.\n" +
        "Creates or updates .husky/pre-commit to run queryaware scan before every commit.\n" +
        "The hook will block the commit if any issues are found.")
        .option("--path <targetPath>", "Source folder to scan in the pre-commit hook", "./src")
        .option("--hook-file <hookFilePath>", "Husky hook file to write the command into", ".husky/pre-commit")
        .action((options) => {
        setupHuskyPreCommit(options.path, options.hookFile);
        console.log(`Husky pre-commit hook updated at ${options.hookFile}`);
        console.log(`Configured command: npx @catisho/queryaware scan ${options.path}`);
        process.exitCode = 0;
    });
    program.parse(argv);
}
