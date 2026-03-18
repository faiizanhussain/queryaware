import { healthCheck } from "./service";

const app = { get: (_path: string, handler: unknown) => handler };
app.get("/health", routeHandler);

export function routeHandler() {
  return healthCheck();
}
