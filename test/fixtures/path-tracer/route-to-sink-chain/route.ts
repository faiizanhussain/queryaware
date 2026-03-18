import { getFiles } from "./service";

const app = { get: (_path: string, handler: unknown) => handler };

app.get("/files", routeHandler);

export function routeHandler() {
  return getFiles();
}
