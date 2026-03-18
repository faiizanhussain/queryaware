import { Node, SyntaxKind } from "ts-morph";
import type { CallGraph, CallNode, RouteEntry, SinkNode, TracedPath } from "./types.js";

interface TraversalState {
  key: string;
  hops: TracedPath["hops"];
  visited: Set<string>;
  hasUnresolvedHops: boolean;
}

export function tracePaths(entries: RouteEntry[], graph: CallGraph, sinks: SinkNode[]): TracedPath[] {
  const allEdges = Array.from(graph.values()).flat();
  const nodeIndex = buildNodeIndex(allEdges);
  const sinkAssignments = assignSinksToNodes(sinks, nodeIndex);

  const traced: TracedPath[] = [];

  for (const route of entries) {
    const startKeys = resolveRouteStartKeys(route, nodeIndex);

    if (startKeys.length === 0) {
      traced.push({
        route,
        hops: [
          {
            file: route.file,
            fn: inferRouteHandlerName(route),
            line: route.line,
            unresolved: true,
            reason: "route handler could not be resolved to call graph node"
          }
        ],
        sink: null,
        hasUnresolvedHops: true
      });
      continue;
    }

    for (const startKey of startKeys) {
      const startNode = nodeIndex.get(startKey);
      if (!startNode) {
        continue;
      }

      const stack: TraversalState[] = [
        {
          key: startKey,
          hops: [toHop(startNode)],
          visited: new Set([startKey]),
          hasUnresolvedHops: false
        }
      ];

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        const edges = graph.get(current.key) ?? [];
        const unresolvedEdges = edges.filter((edge) => edge.unresolved || !edge.to);
        const hasUnresolved = current.hasUnresolvedHops || unresolvedEdges.length > 0;

        const sink = sinkAssignments.get(current.key) ?? null;
        if (sink) {
          traced.push({
            route,
            hops: addUnresolvedMarker(current.hops, unresolvedEdges),
            sink,
            hasUnresolvedHops: hasUnresolved
          });
          continue;
        }

        const nextEdges = edges
          .filter((edge) => edge.to)
          .sort((a, b) => (a.to as CallNode).key.localeCompare((b.to as CallNode).key));

        let advanced = false;

        for (const edge of nextEdges) {
          const next = edge.to as CallNode;
          if (current.visited.has(next.key)) {
            continue;
          }

          advanced = true;
          const nextVisited = new Set(current.visited);
          nextVisited.add(next.key);

          stack.push({
            key: next.key,
            hops: [...addUnresolvedMarker(current.hops, unresolvedEdges), toHop(next)],
            visited: nextVisited,
            hasUnresolvedHops: hasUnresolved
          });
        }

        if (!advanced) {
          traced.push({
            route,
            hops: addUnresolvedMarker(current.hops, unresolvedEdges),
            sink: null,
            hasUnresolvedHops: hasUnresolved
          });
        }
      }
    }
  }

  return dedupeAndSortPaths(traced);
}

function assignSinksToNodes(sinks: SinkNode[], nodeIndex: Map<string, CallNode>): Map<string, SinkNode> {
  const byFile = new Map<string, CallNode[]>();

  for (const node of nodeIndex.values()) {
    const list = byFile.get(node.file) ?? [];
    list.push(node);
    byFile.set(node.file, list);
  }

  for (const list of byFile.values()) {
    list.sort((a, b) => a.line - b.line);
  }

  const assignments = new Map<string, SinkNode>();

  for (const sink of sinks) {
    const candidates = byFile.get(sink.file) ?? [];
    if (candidates.length === 0) {
      continue;
    }

    let owner: CallNode | null = null;
    for (const candidate of candidates) {
      if (candidate.line <= sink.line) {
        owner = candidate;
        continue;
      }

      break;
    }

    if (!owner) {
      owner = candidates[0];
    }

    const existing = assignments.get(owner.key);
    if (!existing) {
      assignments.set(owner.key, sink);
      continue;
    }

    if (sink.line < existing.line) {
      assignments.set(owner.key, sink);
    }
  }

  return assignments;
}

function resolveRouteStartKeys(route: RouteEntry, nodeIndex: Map<string, CallNode>): string[] {
  const candidates = Array.from(nodeIndex.values()).filter((node) => node.file === route.file);
  if (candidates.length === 0) {
    return [];
  }

  const inferred = inferRouteHandlerName(route);
  const declarationLine = getHandlerDeclarationLine(route);

  const exactLine = candidates.filter((node) => node.fn === inferred && node.line === declarationLine);
  if (exactLine.length > 0) {
    return exactLine.map((node) => node.key);
  }

  const sameSymbol = candidates
    .filter((node) => node.fn === inferred)
    .sort((a, b) => Math.abs(a.line - declarationLine) - Math.abs(b.line - declarationLine));
  if (sameSymbol.length > 0) {
    return [sameSymbol[0].key];
  }

  const sameLine = candidates.filter((node) => node.line === declarationLine);
  if (sameLine.length > 0) {
    return sameLine.map((node) => node.key);
  }

  const nearest = candidates
    .filter((node) => node.line <= declarationLine)
    .sort((a, b) => b.line - a.line)[0];

  return nearest ? [nearest.key] : [];
}

function inferRouteHandlerName(route: RouteEntry): string {
  const { handlerNode } = route;

  if (Node.isFunctionDeclaration(handlerNode)) {
    return handlerNode.getName() ?? "<anonymous>";
  }

  if (Node.isMethodDeclaration(handlerNode)) {
    const classDeclaration = handlerNode.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const className = classDeclaration?.getName();
    const methodName = handlerNode.getName();
    return className ? `${className}.${methodName}` : methodName;
  }

  if (Node.isIdentifier(handlerNode)) {
    return handlerNode.getText();
  }

  if (Node.isPropertyAccessExpression(handlerNode)) {
    return handlerNode.getName();
  }

  if (Node.isArrowFunction(handlerNode) || Node.isFunctionExpression(handlerNode)) {
    const variableDeclaration = handlerNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (variableDeclaration) {
      return variableDeclaration.getName();
    }

    return "<anonymous>";
  }

  return "<anonymous>";
}

function getHandlerDeclarationLine(route: RouteEntry): number {
  const { handlerNode } = route;

  if (Node.isIdentifier(handlerNode)) {
    const definition = handlerNode.getDefinitions()[0]?.getDeclarationNode();
    if (definition) {
      return definition.getStartLineNumber();
    }
  }

  if (Node.isPropertyAccessExpression(handlerNode)) {
    const definition = handlerNode.getNameNode().getDefinitions()[0]?.getDeclarationNode();
    if (definition) {
      return definition.getStartLineNumber();
    }
  }

  return handlerNode.getStartLineNumber();
}

function buildNodeIndex(edges: Array<{ from: CallNode; to: CallNode | null }>): Map<string, CallNode> {
  const index = new Map<string, CallNode>();

  for (const edge of edges) {
    index.set(edge.from.key, edge.from);
    if (edge.to) {
      index.set(edge.to.key, edge.to);
    }
  }

  return index;
}

function toHop(node: CallNode): TracedPath["hops"][number] {
  return {
    file: node.file,
    fn: node.fn,
    line: node.line
  };
}

function addUnresolvedMarker(
  hops: TracedPath["hops"],
  unresolvedEdges: Array<{ reason?: string }>
): TracedPath["hops"] {
  if (unresolvedEdges.length === 0 || hops.length === 0) {
    return hops;
  }

  const reason = unresolvedEdges[0].reason ?? "unresolved call edge";
  const updated = [...hops];
  const last = updated[updated.length - 1];

  updated[updated.length - 1] = {
    ...last,
    unresolved: true,
    reason
  };

  return updated;
}

function dedupeAndSortPaths(paths: TracedPath[]): TracedPath[] {
  const unique = new Map<string, TracedPath>();

  for (const path of paths) {
    const key = [
      path.route.file,
      String(path.route.line),
      path.route.httpMethod,
      path.route.routePath,
      path.hops.map((hop) => `${hop.file}#${hop.fn}:${hop.line}`).join("->"),
      path.sink ? `${path.sink.file}:${path.sink.line}:${path.sink.model}:${path.sink.operation}` : "no-sink",
      path.hasUnresolvedHops ? "1" : "0"
    ].join("|");

    if (!unique.has(key)) {
      unique.set(key, path);
    }
  }

  return Array.from(unique.values()).sort(comparePaths);
}

function comparePaths(a: TracedPath, b: TracedPath): number {
  const left = `${a.route.file}:${a.route.line}:${a.route.httpMethod}:${a.route.routePath}:${a.hops
    .map((hop) => `${hop.file}#${hop.fn}:${hop.line}`)
    .join("->")}:${a.sink ? `${a.sink.file}:${a.sink.line}:${a.sink.model}.${a.sink.operation}` : "no-sink"}`;

  const right = `${b.route.file}:${b.route.line}:${b.route.httpMethod}:${b.route.routePath}:${b.hops
    .map((hop) => `${hop.file}#${hop.fn}:${hop.line}`)
    .join("->")}:${b.sink ? `${b.sink.file}:${b.sink.line}:${b.sink.model}.${b.sink.operation}` : "no-sink"}`;

  return left.localeCompare(right);
}
