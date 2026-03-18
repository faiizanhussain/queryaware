import { describe, expect, it } from "vitest";
import { detectRawSqlIssues } from "../../src/detectors/raw-sql.js";

describe("detectRawSqlIssues", () => {
  it("detects unsafe raw query methods", () => {
    const lines = ["await prisma.$queryRawUnsafe(`SELECT * FROM users`)" , "await prisma.$executeRawUnsafe('DELETE FROM users')"];
    const issues = detectRawSqlIssues(lines);

    expect(issues.some((issue) => issue.type === "unsafe-raw-query" && issue.call === "$queryRawUnsafe()")).toBe(true);
    expect(issues.some((issue) => issue.type === "unsafe-raw-query" && issue.call === "$executeRawUnsafe()")).toBe(true);
  });

  it("detects Prisma.raw usage", () => {
    const issues = detectRawSqlIssues(["const q = Prisma.sql`SELECT * FROM users ${Prisma.raw(sortBy)}`"]);
    expect(issues).toEqual([
      {
        type: "prisma-raw-fragment",
        line: 1,
        call: "Prisma.raw()"
      },
      {
        type: "raw-select-star",
        line: 1,
        call: "SELECT *"
      }
    ]);
  });

  it("detects unscoped DELETE and UPDATE", () => {
    const issues = detectRawSqlIssues([
      "await prisma.$executeRaw`DELETE FROM users`",
      "await prisma.$executeRaw`UPDATE users",
      "SET active = false`"
    ]);

    expect(issues.some((issue) => issue.type === "raw-unscoped-delete")).toBe(true);
    expect(issues.some((issue) => issue.type === "raw-unscoped-update")).toBe(true);
  });

  it("does not flag scoped DELETE and UPDATE", () => {
    const issues = detectRawSqlIssues([
      "await prisma.$executeRaw`DELETE FROM users",
      "WHERE id = ${id}`",
      "await prisma.$executeRaw`UPDATE users",
      "SET active = false",
      "WHERE id = ${id}`"
    ]);

    expect(issues.some((issue) => issue.type === "raw-unscoped-delete")).toBe(false);
    expect(issues.some((issue) => issue.type === "raw-unscoped-update")).toBe(false);
  });

  it("does not flag prose or regex text that contains UPDATE/SET words", () => {
    const issues = detectRawSqlIssues([
      "const isActionLine = /^(Monitor|Add|Update|Set|Deploy)/i.test(lineTrimmed);",
      "This line declares a boolean variable and is not SQL",
      "UPDATE has no where clause"
    ]);

    expect(issues.some((issue) => issue.type === "raw-unscoped-update")).toBe(false);
    expect(issues.some((issue) => issue.type === "raw-unscoped-delete")).toBe(false);
    expect(issues.some((issue) => issue.type === "raw-select-star")).toBe(false);
  });
});
