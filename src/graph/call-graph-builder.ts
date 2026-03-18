import { Node, SyntaxKind, type CallExpression, type Project } from "ts-morph";
import type { CallEdge, CallGraph, CallNode } from "./types.js";

export function buildCallGraph(project: Project): CallGraph {
  const graph: CallGraph = new Map<string, CallEdge[]>();
  const dedupeKeys = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpression of callExpressions) {
      const from = getCallerNode(callExpression);
      if (!from) {
        continue;
      }

      const edge = resolveEdge(from, callExpression);
      const dedupeKey = `${from.key}|${edge.to?.key ?? "?"}`;
      if (dedupeKeys.has(dedupeKey)) {
        continue;
      }

      dedupeKeys.add(dedupeKey);

      const edges = graph.get(from.key) ?? [];
      edges.push(edge);
      graph.set(from.key, edges);
    }
  }

  return graph;
}

function resolveEdge(from: CallNode, callExpression: CallExpression): CallEdge {
  const calleeExpression = callExpression.getExpression();

  if (Node.isElementAccessExpression(calleeExpression)) {
    return {
      from,
      to: null,
      unresolved: true,
      reason: "dynamic"
    };
  }

  const definitionNode = resolveDefinitionNode(callExpression);
  if (!definitionNode) {
    return {
      from,
      to: null,
      unresolved: true,
      reason: buildUnresolvedReason(calleeExpression)
    };
  }

  const to = toCallNode(definitionNode);
  if (!to) {
    return {
      from,
      to: null,
      unresolved: true,
      reason: "definition did not map to callable declaration"
    };
  }

  return { from, to };
}

function resolveDefinitionNode(callExpression: CallExpression): Node | null {
  const calleeExpression = callExpression.getExpression();

  if (Node.isIdentifier(calleeExpression)) {
    const definition = calleeExpression.getDefinitions()[0];
    return definition?.getDeclarationNode() ?? null;
  }

  if (Node.isPropertyAccessExpression(calleeExpression)) {
    const nameNode = calleeExpression.getNameNode();
    const nameDefinition = nameNode.getDefinitions()[0]?.getDeclarationNode();
    if (nameDefinition) {
      return nameDefinition;
    }

    const targetType = calleeExpression.getExpression().getType();
    const propertySymbol = targetType.getProperty(calleeExpression.getName());
    const declaration = propertySymbol?.getDeclarations()[0];
    return declaration ?? null;
  }

  return null;
}

function getCallerNode(callExpression: CallExpression): CallNode | null {
  const callableParent = callExpression.getFirstAncestor((ancestor) =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isArrowFunction(ancestor)
  );

  if (!callableParent) {
    return null;
  }

  if (Node.isFunctionDeclaration(callableParent)) {
    return createNode(callableParent, callableParent.getName() ?? "<anonymous>");
  }

  if (Node.isMethodDeclaration(callableParent)) {
    return createNode(callableParent, getMethodName(callableParent));
  }

  const variableDeclaration = callableParent.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (variableDeclaration) {
    return createNode(callableParent, variableDeclaration.getName());
  }

  return createNode(callableParent, "<anonymous>");
}

function toCallNode(node: Node): CallNode | null {
  if (Node.isFunctionDeclaration(node)) {
    return createNode(node, node.getName() ?? "<anonymous>");
  }

  if (Node.isMethodDeclaration(node)) {
    return createNode(node, getMethodName(node));
  }

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) {
      return null;
    }

    return createNode(initializer, node.getName());
  }

  return null;
}

function createNode(node: Node, fn: string): CallNode {
  const file = node.getSourceFile().getFilePath();
  const line = node.getStartLineNumber();
  const key = `${file}#${fn}:${line}`;
  return {
    key,
    file,
    fn,
    line
  };
}

function getMethodName(node: Node): string {
  if (!Node.isMethodDeclaration(node)) {
    return "<method>";
  }

  const classDeclaration = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  const className = classDeclaration?.getName();
  const methodName = node.getName();

  if (className) {
    return `${className}.${methodName}`;
  }

  return methodName;
}

function buildUnresolvedReason(calleeExpression: Node): string {
  if (Node.isIdentifier(calleeExpression)) {
    return `unresolved identifier call: ${calleeExpression.getText()}`;
  }

  if (Node.isPropertyAccessExpression(calleeExpression)) {
    return `unresolved member call: ${calleeExpression.getText()}`;
  }

  return `unresolved call expression: ${calleeExpression.getKindName()}`;
}
