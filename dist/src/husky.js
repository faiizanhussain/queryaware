import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const START_MARKER = "# queryaware:start";
const END_MARKER = "# queryaware:end";
function buildManagedBlock(targetPath) {
    return `${START_MARKER}\nnpx @catisho/queryaware scan ${targetPath}\n${END_MARKER}`;
}
function upsertManagedBlock(content, targetPath) {
    const managedBlock = buildManagedBlock(targetPath);
    if (content.includes(START_MARKER) && content.includes(END_MARKER)) {
        return content.replace(new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`), managedBlock);
    }
    const trimmed = content.trimEnd();
    return `${trimmed}\n\n${managedBlock}\n`;
}
export function setupHuskyPreCommit(targetPath, hookFilePath = ".husky/pre-commit") {
    const hookDirectory = dirname(hookFilePath);
    if (!existsSync(hookDirectory)) {
        mkdirSync(hookDirectory, { recursive: true });
    }
    const exists = existsSync(hookFilePath);
    if (!exists) {
        const content = [
            "#!/usr/bin/env sh",
            '. "$(dirname -- "$0")/_/husky.sh"',
            "",
            buildManagedBlock(targetPath),
            ""
        ].join("\n");
        writeFileSync(hookFilePath, content, "utf-8");
    }
    else {
        const current = readFileSync(hookFilePath, "utf-8");
        const updated = upsertManagedBlock(current, targetPath);
        writeFileSync(hookFilePath, updated, "utf-8");
    }
    try {
        chmodSync(hookFilePath, 0o755);
    }
    catch {
        // no-op for environments that do not support chmod (e.g. some Windows setups)
    }
}
