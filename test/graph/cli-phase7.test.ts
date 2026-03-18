import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/scanner.js", () => ({
  scanTarget: vi.fn(() => ({ issues: [] }))
}));

vi.mock("../../src/reporter.js", () => ({
  reportIssues: vi.fn(() => 0),
  reportPaths: vi.fn()
}));

vi.mock("../../src/husky.js", () => ({
  setupHuskyPreCommit: vi.fn()
}));

import { runCli } from "../../src/cli.js";
import { reportIssues } from "../../src/reporter.js";
import { scanTarget } from "../../src/scanner.js";

describe("runCli Phase 7 scan flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("passes skipGraph option to scanTarget", () => {
    runCli(["node", "queryaware", "scan", "./src", "--skip-graph"]);

    expect(scanTarget).toHaveBeenCalledWith("./src", { skipGraph: true, skipStatic: false });
    expect(reportIssues).toHaveBeenCalledTimes(1);
  });

  it("passes skipStatic option to scanTarget", () => {
    runCli(["node", "queryaware", "scan", "./src", "--skip-static"]);

    expect(scanTarget).toHaveBeenCalledWith("./src", { skipGraph: false, skipStatic: true });
    expect(reportIssues).toHaveBeenCalledTimes(1);
  });

  it("passes both skip flags together", () => {
    runCli(["node", "queryaware", "scan", "./src", "--skip-graph", "--skip-static"]);

    expect(scanTarget).toHaveBeenCalledWith("./src", { skipGraph: true, skipStatic: true });
    expect(reportIssues).toHaveBeenCalledTimes(1);
  });

  it("defaults skip flags to false when omitted", () => {
    runCli(["node", "queryaware", "scan", "./src"]);

    expect(scanTarget).toHaveBeenCalledWith("./src", { skipGraph: false, skipStatic: false });
    expect(reportIssues).toHaveBeenCalledTimes(1);
  });
});
