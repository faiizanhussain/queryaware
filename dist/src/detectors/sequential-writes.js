import { detectInsideLoops } from "./loop-detector.js";
export function detectSequentialWrites(lines) {
    return detectInsideLoops(lines, {
        matchPattern: /prisma\.\w+\.(create|upsert|update)\(/,
        capturePattern: /(prisma\.\w+\.(create|upsert|update))\s*\(/,
        fallbackCall: "Prisma write"
    });
}
