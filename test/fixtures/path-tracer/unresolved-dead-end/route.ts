const app = { get: (_path: string, handler: unknown) => handler };

app.get("/dynamic", routeHandler);

export function routeHandler() {
  const handlers: Record<string, () => string> = { list: () => "ok" };
  return handlers["list"]();
}
