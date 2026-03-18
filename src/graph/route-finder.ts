import { Node, Project, SourceFile, SyntaxKind } from "ts-morph";
import type { RouteEntry } from "./types.js";

const CALL_BASED_HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "all"
]);

const NEST_DECORATOR_METHODS: Record<string, string> = {
  Get: "get",
  Post: "post",
  Put: "put",
  Patch: "patch",
  Delete: "delete",
  Head: "head",
  Options: "options",
  All: "all"
};

type RouteMatcher = (sourceFile: SourceFile) => RouteEntry[];

const ROUTE_MATCHERS: RouteMatcher[] = [
  findCallBasedRoutes,
  findNestDecoratorRoutes,
  findNextAppApiRoutes,
  findNextPagesApiRoutes,
  findSvelteKitServerRoutes
];

const FILE_BASED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function findRouteEntries(project: Project): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    for (const matcher of ROUTE_MATCHERS) {
      const discoveredEntries = matcher(sourceFile);
      for (const entry of discoveredEntries) {
        const key = `${entry.file}:${entry.line}:${entry.httpMethod}:${entry.routePath}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        entries.push(entry);
      }
    }
  }

  return entries.sort((a, b) => {
    if (a.file === b.file) {
      return a.line - b.line;
    }

    return a.file.localeCompare(b.file);
  });
}

function findCallBasedRoutes(sourceFile: SourceFile): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const callExpression of callExpressions) {
    const expression = callExpression.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) {
      continue;
    }

    const httpMethod = expression.getName().toLowerCase();
    if (!CALL_BASED_HTTP_METHODS.has(httpMethod)) {
      continue;
    }

    const args = callExpression.getArguments();
    if (args.length === 0) {
      continue;
    }

    const handlerArg = findHandlerArgument(args);
    if (!handlerArg) {
      continue;
    }

    const routePath = args.length >= 2 ? extractRoutePath(args[0]) : "/";
    entries.push({
      file: sourceFile.getFilePath(),
      line: handlerArg.getStartLineNumber(),
      httpMethod,
      routePath,
      handlerNode: handlerArg
    });
  }

  return entries;
}

function findNestDecoratorRoutes(sourceFile: SourceFile): RouteEntry[] {
  const entries: RouteEntry[] = [];

  for (const classDeclaration of sourceFile.getClasses()) {
    for (const method of classDeclaration.getMethods()) {
      for (const decorator of method.getDecorators()) {
        const decoratorName = decorator.getName();
        const httpMethod = NEST_DECORATOR_METHODS[decoratorName];
        if (!httpMethod) {
          continue;
        }

        const decoratorArgs = decorator.getArguments();
        const routePath = decoratorArgs.length > 0 ? extractRoutePath(decoratorArgs[0]) : "/";

        entries.push({
          file: sourceFile.getFilePath(),
          line: method.getStartLineNumber(),
          httpMethod,
          routePath,
          handlerNode: method
        });
      }
    }
  }

  return entries;
}

function findNextAppApiRoutes(sourceFile: SourceFile): RouteEntry[] {
  const relativeApiPath = getRelativePathMatch(sourceFile.getFilePath(), ["app", "api"], "route.ts");
  if (relativeApiPath === null) {
    return [];
  }

  const routePath = buildRoutePath(relativeApiPath);
  const entries: RouteEntry[] = [];

  for (const handler of getNamedExportHandlers(sourceFile)) {
    if (!FILE_BASED_HTTP_METHODS.has(handler.exportName)) {
      continue;
    }

    entries.push({
      file: sourceFile.getFilePath(),
      line: handler.handlerNode.getStartLineNumber(),
      httpMethod: handler.exportName.toLowerCase(),
      routePath,
      handlerNode: handler.handlerNode
    });
  }

  return entries;
}

function findNextPagesApiRoutes(sourceFile: SourceFile): RouteEntry[] {
  const normalizedFilePath = toSlashPath(sourceFile.getFilePath());
  const pagesApiMatch = normalizedFilePath.match(/\/pages\/api\/(.+)\.ts$/i);
  if (!pagesApiMatch) {
    return [];
  }

  const routePath = buildRoutePath(pagesApiMatch[1]);
  const defaultDeclaration = sourceFile.getDefaultExportSymbol()?.getDeclarations()[0];
  if (!defaultDeclaration) {
    return [];
  }

  return [
    {
      file: sourceFile.getFilePath(),
      line: defaultDeclaration.getStartLineNumber(),
      httpMethod: "all",
      routePath,
      handlerNode: defaultDeclaration
    }
  ];
}

function findSvelteKitServerRoutes(sourceFile: SourceFile): RouteEntry[] {
  const normalizedFilePath = toSlashPath(sourceFile.getFilePath());
  const routeMatch = normalizedFilePath.match(/\/src\/routes\/(.*)\/\+server\.ts$/i);
  const rootMatch = normalizedFilePath.match(/\/src\/routes\/\+server\.ts$/i);

  if (!routeMatch && !rootMatch) {
    return [];
  }

  const relativeRoute = routeMatch ? routeMatch[1] : "";
  const routePath = buildRoutePath(relativeRoute);
  const entries: RouteEntry[] = [];

  for (const handler of getNamedExportHandlers(sourceFile)) {
    if (!FILE_BASED_HTTP_METHODS.has(handler.exportName)) {
      continue;
    }

    entries.push({
      file: sourceFile.getFilePath(),
      line: handler.handlerNode.getStartLineNumber(),
      httpMethod: handler.exportName.toLowerCase(),
      routePath,
      handlerNode: handler.handlerNode
    });
  }

  return entries;
}

function getRelativePathMatch(filePath: string, anchorSegments: string[], suffix: string): string | null {
  const normalized = toSlashPath(filePath);
  const anchor = `/${anchorSegments.join("/")}/`;
  const anchorIndex = normalized.lastIndexOf(anchor);
  if (anchorIndex < 0) {
    return null;
  }

  const afterAnchor = normalized.slice(anchorIndex + anchor.length);
  if (!afterAnchor.endsWith(`/${suffix}`) && afterAnchor !== suffix) {
    return null;
  }

  if (afterAnchor === suffix) {
    return "";
  }

  return afterAnchor.slice(0, -(`/${suffix}`.length));
}

function buildRoutePath(relativePath: string): string {
  if (!relativePath || relativePath === "index") {
    return "/";
  }

  const segments = relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => segment !== "index");

  if (segments.length === 0) {
    return "/";
  }

  return `/${segments.join("/")}`;
}

function toSlashPath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function getNamedExportHandlers(sourceFile: SourceFile): Array<{ exportName: string; handlerNode: Node }> {
  const handlers: Array<{ exportName: string; handlerNode: Node }> = [];

  for (const fn of sourceFile.getFunctions()) {
    const fnName = fn.getName();
    if (!fnName || !fn.isExported()) {
      continue;
    }

    handlers.push({ exportName: fnName, handlerNode: fn });
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const variableStatement = declaration.getVariableStatement();
    if (!variableStatement?.isExported()) {
      continue;
    }

    const name = declaration.getName();
    const initializer = declaration.getInitializer();
    const handlerNode = initializer && isHandlerNode(initializer) ? initializer : declaration;
    handlers.push({ exportName: name, handlerNode });
  }

  return handlers;
}

function findHandlerArgument(args: Node[]): Node | null {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const arg = args[index];
    if (isHandlerNode(arg)) {
      return arg;
    }
  }

  return null;
}

function isHandlerNode(node: Node): boolean {
  return (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isIdentifier(node) ||
    Node.isPropertyAccessExpression(node)
  );
}

function extractRoutePath(pathNode: Node): string {
  if (Node.isStringLiteral(pathNode) || Node.isNoSubstitutionTemplateLiteral(pathNode)) {
    return pathNode.getLiteralText();
  }

  if (Node.isTemplateExpression(pathNode)) {
    return pathNode.getText();
  }

  return "<dynamic>";
}
