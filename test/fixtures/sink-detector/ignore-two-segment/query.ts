export async function connect(prisma: any) {
  await prisma.$connect();
}