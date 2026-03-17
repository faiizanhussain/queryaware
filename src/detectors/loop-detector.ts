export interface LoopBasedIssue {
  line: number;
  call: string;
}

export interface LoopDetectorConfig {
  matchPattern: RegExp;
  capturePattern: RegExp;
  fallbackCall: string;
}

export function detectInsideLoops(lines: string[], config: LoopDetectorConfig): LoopBasedIssue[] {
  const issues: LoopBasedIssue[] = [];
  let loopDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/(for\s*\(|forEach\s*\(|while\s*\()/.test(line)) {
      loopDepth += 1;
    }

    if (config.matchPattern.test(line) && loopDepth > 0) {
      const match = line.match(config.capturePattern);
      const call = match ? `${match[1]}()` : config.fallbackCall;

      issues.push({
        line: index + 1,
        call
      });
    }

    if (line.includes("}")) {
      loopDepth -= 1;
      if (loopDepth < 0) {
        loopDepth = 0;
      }
    }
  }

  return issues;
}