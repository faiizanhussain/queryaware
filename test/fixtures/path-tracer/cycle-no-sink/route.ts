import { a } from "./service";

const app = { get: (_path: string, handler: unknown) => handler };
app.get("/cycle", routeHandler);

export function routeHandler() {
  return a();
}
