export async function run(prisma: any) {
  return prisma.project.findMany({ where: { archived: false } });
}
