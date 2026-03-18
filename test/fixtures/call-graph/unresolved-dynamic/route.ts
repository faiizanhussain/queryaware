const registry: Record<string, () => string> = {
  save: () => "saved"
};

export function routeHandler(operation: string) {
  return registry[operation]();
}
