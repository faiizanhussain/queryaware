import { Service } from "./service";

export function routeHandler() {
  const service = new Service();
  return service.getFiles();
}
