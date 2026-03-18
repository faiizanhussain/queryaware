export async function listFiles() {
  return prisma.file.findMany();
}
