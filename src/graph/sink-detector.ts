import { Node, SyntaxKind, type Project } from "ts-morph";
import type { SinkNode } from "./types.js";

const RAW_QUERY_METHODS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe"
]);

/**
 * Returns true for any expression that resolves to a Prisma *instance*:
 *   - `prisma`           — bare identifier (Next.js / module singleton)
 *   - `this.prisma`      — class property (NestJS DI / service classes)
 *   - `*.prisma`         — any other property named `prisma`
 * Deliberately ignores `Prisma` (uppercase) — that is the type/utility namespace
 * from @prisma/client, not a database connection.
 */
function isPrismaInstance(node: Node): boolean {
  if (Node.isIdentifier(node)) {
    return node.getText() === "prisma";
  }
  if (Node.isPropertyAccessExpression(node)) {
    return node.getName() === "prisma";
  }
  return false;
}

export function findPrismaSinks(project: Project): SinkNode[] {
  const sinks: SinkNode[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    // ── CallExpression: prisma.model.op() and prisma.$queryRaw(...) ──────────
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpression of callExpressions) {
      const expression = callExpression.getExpression();
      if (!Node.isPropertyAccessExpression(expression)) {
        continue;
      }

      const inner = expression.getExpression();
      const methodName = expression.getName();

      // Pattern 1: prisma.$queryRaw() / this.prisma.$executeRaw() etc. (2-level)
      if (isPrismaInstance(inner) && RAW_QUERY_METHODS.has(methodName)) {
        sinks.push({
          file: sourceFile.getFilePath(),
          line: callExpression.getStartLineNumber(),
          model: "sql",
          operation: methodName
        });
        continue;
      }

      // Pattern 2: prisma.model.op() / this.prisma.model.op() (3-level)
      if (!Node.isPropertyAccessExpression(inner)) {
        continue;
      }

      if (!isPrismaInstance(inner.getExpression())) {
        continue;
      }

      sinks.push({
        file: sourceFile.getFilePath(),
        line: callExpression.getStartLineNumber(),
        model: inner.getName(),
        operation: methodName
      });
    }

    // ── TaggedTemplateExpression: prisma.$queryRaw`SELECT ...` ───────────────
    // Prisma allows $queryRaw as a tagged template literal in addition to a
    // regular function call. The AST node is TaggedTemplateExpression, not
    // CallExpression, so it needs a separate sweep.
    const taggedTemplates = sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression);

    for (const tagged of taggedTemplates) {
      const tag = tagged.getTag();
      if (!Node.isPropertyAccessExpression(tag)) {
        continue;
      }

      if (!isPrismaInstance(tag.getExpression())) {
        continue;
      }

      const methodName = tag.getName();
      if (!RAW_QUERY_METHODS.has(methodName)) {
        continue;
      }

      sinks.push({
        file: sourceFile.getFilePath(),
        line: tagged.getStartLineNumber(),
        model: "sql",
        operation: methodName
      });
    }
  }

  return sinks.sort((a, b) => {
    if (a.file === b.file) {
      return a.line - b.line;
    }

    return a.file.localeCompare(b.file);
  });
}