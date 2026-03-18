export async function run(prisma: any) {
  await prisma.user.findUnique({ where: { id: "u1" } });
  await prisma.project.update({ where: { id: "p1" }, data: { name: "n" } });
}