import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPaths = [{ route: { httpMethod: "get", routePath: "/files" }, hops: [], sink: null, hasUnresolvedHops: false }];

vi.mock("../../src/scanner.js", () => ({
  scanTarget: vi.fn()
}));

vi.mock("../../src/reporter.js", () => ({
  reportIssues: vi.fn(() => 0),
  reportPaths: vi.fn()
}));

vi.mock("../../src/husky.js", () => ({
  setupHuskyPreCommit: vi.fn()
}));

import { runCli } from "../../src/cli.js";
import { reportIssues, reportPaths } from "../../src/reporter.js";
import { scanTarget } from "../../src/scanner.js";

const mockedScanTarget = scanTarget as ReturnType<typeof vi.fn>;

describe("runCli Phase 8 reportPaths wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("calls reportPaths when scanTarget returns paths", () => {
    mockedScanTarget.mockReturnValue({ issues: [], paths: mockPaths });

    runCli(["node", "queryaware", "scan", "./src"]);

    expect(reportPaths).toHaveBeenCalledTimes(1);
    expect(reportPaths).toHaveBeenCalledWith(mockPaths, { verbose: false });
  });

  it("does not call reportPaths when scanTarget omits paths (skipGraph case)", () => {
    mockedScanTarget.mockReturnValue({ issues: [] });

    runCli(["node", "queryaware", "scan", "./src", "--skip-graph"]);

    expect(reportPaths).not.toHaveBeenCalled();
  });

  it("does not call reportPaths when paths is undefined explicitly", () => {
    mockedScanTarget.mockReturnValue({ issues: [], paths: undefined });

    runCli(["node", "queryaware", "scan", "./src"]);

    expect(reportPaths).not.toHaveBeenCalled();
  });

  it("calls reportPaths with empty array when paths is []", () => {
    mockedScanTarget.mockReturnValue({ issues: [], paths: [] });

    runCli(["node", "queryaware", "scan", "./src"]);

    expect(reportPaths).toHaveBeenCalledWith([], { verbose: false });
  });

  it("passes verbose=true to reportPaths when --verbose is set", () => {
    mockedScanTarget.mockReturnValue({ issues: [], paths: mockPaths });

    runCli(["node", "queryaware", "scan", "./src", "--verbose"]);

    expect(reportPaths).toHaveBeenCalledWith(mockPaths, { verbose: true });
  });

  it("reportPaths is called after reportIssues", () => {
    const callOrder: string[] = [];
    (reportPaths as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push("reportPaths"));
    (reportIssues as ReturnType<typeof vi.fn>).mockImplementation(() => { callOrder.push("reportIssues"); return 0; });

    mockedScanTarget.mockReturnValue({ issues: [], paths: mockPaths });

    runCli(["node", "queryaware", "scan", "./src"]);

    expect(callOrder).toEqual(["reportIssues", "reportPaths"]);
  });
});
