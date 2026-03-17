import { detectInsideLoops } from "./loop-detector.js";

export interface NPlusOneIssue {
  line: number;
  call: string;
}

export function detectNPlusOne(lines: string[]): NPlusOneIssue[] {
  return detectInsideLoops(lines, {
    matchPattern: /prisma\.\w+\.\w+/,
    capturePattern: /(prisma\.\w+\.\w+)\s*\(/,
    fallbackCall: "Prisma query"
  });
}