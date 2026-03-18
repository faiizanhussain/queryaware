import { listFiles } from "./service";

const app = { get: (_path: string, handler: unknown) => handler };
app.get("/files", routeHandler);

export async function routeHandler() {
  return listFiles();
}
