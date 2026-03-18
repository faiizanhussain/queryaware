export async function load(db: any) {
  return db.file.findMany({ where: { workspaceId: "w1" } });
}