export function detectInsideLoops(lines, config) {
    const issues = [];
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
