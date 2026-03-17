import { detectInsideLoops } from "./loop-detector.js";
export function detectNPlusOne(lines) {
    return detectInsideLoops(lines, {
        matchPattern: /prisma\.\w+\.\w+/,
        capturePattern: /(prisma\.\w+\.\w+)\s*\(/,
        fallbackCall: "Prisma query"
    });
}
