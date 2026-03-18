import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "glob";
import { Project } from "ts-morph";

export function loadProject(targetDir: string): Project {
  const absoluteTarget = resolve(targetDir);
  const tsConfigPath = resolve(absoluteTarget, "tsconfig.json");

  if (existsSync(tsConfigPath)) {
    const project = new Project({
      tsConfigFilePath: tsConfigPath,
      skipAddingFilesFromTsConfig: false
    });

    for (const sf of project.getSourceFiles()) {
      const fp = sf.getFilePath();
      if (fp.includes("/node_modules/") || fp.includes("\\node_modules\\")) {
        project.removeSourceFile(sf);
      }
    }

    return project;
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true
  });

  const files = globSync("**/*.ts", {
    cwd: absoluteTarget,
    absolute: true,
    nodir: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]
  });

  project.addSourceFilesAtPaths(files);

  return project;
}
