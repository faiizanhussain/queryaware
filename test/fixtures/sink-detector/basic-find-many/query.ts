export async function loadFiles(prisma: any) {
  return prisma.file.findMany({ where: { workspaceId: "w1" } });
}