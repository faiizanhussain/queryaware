export type RawSqlIssueType =
  | "unsafe-raw-query"
  | "prisma-raw-fragment"
  | "raw-select-star"
  | "raw-unscoped-delete"
  | "raw-unscoped-update";

export interface RawSqlIssue {
  type: RawSqlIssueType;
  line: number;
  call: string;
}

// Lines to look ahead when checking for a WHERE clause after UPDATE/DELETE.
// 12 covers most multi-line SQL blocks without spanning into a different query.
const WHERE_LOOKAHEAD = 12;
const SQL_CONTEXT_WINDOW = 3;

function isLikelySqlContext(lines: string[], index: number): boolean {
  const start = Math.max(0, index - SQL_CONTEXT_WINDOW);
  const end = Math.min(lines.length, index + SQL_CONTEXT_WINDOW + 1);
  const window = lines.slice(start, end).join(" ");

  return /(\$(query|execute)Raw(?:Unsafe)?\s*[(`]|Prisma\.sql\s*`)/i.test(window);
}

export function detectRawSqlIssues(lines: string[]): RawSqlIssue[] {
  const issues: RawSqlIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // $queryRawUnsafe / $executeRawUnsafe — no parameterization at all
    const unsafeMatch = line.match(/\$(query|execute)RawUnsafe\s*[(`]/);
    if (unsafeMatch) {
      issues.push({
        type: "unsafe-raw-query",
        line: i + 1,
        call: `$${unsafeMatch[1]}RawUnsafe()`
      });
    }

    // Prisma.raw() — injects its argument verbatim into a Prisma.sql template
    if (/\bPrisma\.raw\s*\(/.test(line)) {
      issues.push({ type: "prisma-raw-fragment", line: i + 1, call: "Prisma.raw()" });
    }

    // SELECT * — over-fetches every column, exposes sensitive fields
    if (/\bSELECT\s+\*/i.test(line) && isLikelySqlContext(lines, i)) {
      issues.push({ type: "raw-select-star", line: i + 1, call: "SELECT *" });
    }

    // DELETE FROM without WHERE — unscoped deletion of entire table
    if (/\bDELETE\s+FROM\b/i.test(line) && isLikelySqlContext(lines, i)) {
      const block = lines.slice(i, i + WHERE_LOOKAHEAD).join(" ");
      if (!/\bWHERE\b/i.test(block)) {
        const tableMatch = line.match(/\bDELETE\s+FROM\s+["'`]?(\w+)["'`]?/i);
        issues.push({
          type: "raw-unscoped-delete",
          line: i + 1,
          call: tableMatch ? `DELETE FROM ${tableMatch[1]}` : "DELETE FROM"
        });
      }
    }

    // UPDATE without WHERE — unscoped mutation of entire table
    if (/\bUPDATE\b/i.test(line) && isLikelySqlContext(lines, i)) {
      const block = lines.slice(i, i + WHERE_LOOKAHEAD).join(" ");
      if (/\bSET\b/i.test(block) && !/\bWHERE\b/i.test(block)) {
        const tableMatch = line.match(/\bUPDATE\s+["'`]?(\w+)["'`]?/i);
        issues.push({
          type: "raw-unscoped-update",
          line: i + 1,
          call: tableMatch ? `UPDATE ${tableMatch[1]}` : "UPDATE"
        });
      }
    }
  }

  return issues;
}
