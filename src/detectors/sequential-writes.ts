import { detectInsideLoops } from "./loop-detector.js";

export interface SequentialWriteIssue {
  line: number;
  call: string;
}

export function detectSequentialWrites(lines: string[]): SequentialWriteIssue[] {
  return detectInsideLoops(lines, {
    matchPattern: /prisma\.\w+\.(create|upsert|update)\(/,
    capturePattern: /(prisma\.\w+\.(create|upsert|update))\s*\(/,
    fallbackCall: "Prisma write"
  });
}