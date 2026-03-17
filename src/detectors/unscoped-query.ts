export interface UnscopedQueryIssue {
  line: number;
  call: string;
}

export function detectUnscopedQuery(lines: string[]): UnscopedQueryIssue[] {
  const issues: UnscopedQueryIssue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/prisma\.\w+\.findMany\(/.test(line)) {
      const hasWhereInNextThreeLines = lines
        .slice(index + 1, index + 4)
        .some((nextLine) => nextLine.includes("where"));

      if (!hasWhereInNextThreeLines) {
        const match = line.match(/(prisma\.\w+\.findMany)\s*\(/);
        const call = match ? `${match[1]}()` : "prisma.findMany()";

        issues.push({
          line: index + 1,
          call
        });
      }
    }
  }

  return issues;
}