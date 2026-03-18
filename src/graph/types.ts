import type { Node } from "ts-morph";

export interface RouteEntry {
  file: string;
  line: number;
  httpMethod: string;
  routePath: string;
  handlerNode: Node;
}

export interface CallNode {
  key: string;
  file: string;
  fn: string;
  line: number;
}

export interface CallEdge {
  from: CallNode;
  to: CallNode | null;
  unresolved?: boolean;
  reason?: string;
}

export type CallGraph = Map<string, CallEdge[]>;

export interface SinkNode {
  file: string;
  line: number;
  model: string;
  operation: string;
}

export interface TracedPath {
  route: RouteEntry;
  hops: Array<{
    file: string;
    fn: string;
    line: number;
    unresolved?: boolean;
    reason?: string;
  }>;
  sink: SinkNode | null;
  hasUnresolvedHops: boolean;
}

export interface CallGraphResult {
  routes: RouteEntry[];
  paths: TracedPath[];
  sinks: SinkNode[];
}
