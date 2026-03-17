import { Command } from "commander";
import { setupHuskyPreCommit } from "./husky.js";
import { reportIssues } from "./reporter.js";
import { scanTarget } from "./scanner.js";
export function runCli(argv) {
    const program = new Command();
    program
        .name("queryaware")
        .description("Static analysis for ORM query anti-patterns")
        .version("1.0.0");
    program
        .command("scan")
        .description("Scan a folder for ORM query anti-patterns")
        .argument("<targetPath>", "Path to scan, e.g. ./src")
        .option("--fix", "Scaffolded flag for future auto-fix support", false)
        .action((targetPath, options) => {
        const result = scanTarget(targetPath);
        const count = reportIssues(result.issues);
        if (options.fix) {
            console.log("--fix is not implemented yet.");
        }
        process.exitCode = count > 0 ? 1 : 0;
    });
    program
        .command("setup-husky")
        .description("Create or update a Husky pre-commit hook for queryaware")
        .option("--path <targetPath>", "Path to scan in pre-commit", "./src")
        .option("--hook-file <hookFilePath>", "Husky hook file path", ".husky/pre-commit")
        .action((options) => {
        setupHuskyPreCommit(options.path, options.hookFile);
        console.log(`Husky pre-commit hook updated at ${options.hookFile}`);
        console.log(`Configured command: npx @catisho/queryaware scan ${options.path}`);
        process.exitCode = 0;
    });
    program.parse(argv);
}
