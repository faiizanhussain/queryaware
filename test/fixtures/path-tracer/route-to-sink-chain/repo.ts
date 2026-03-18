export function fetchFiles() {
  return prisma.file.findMany({ where: { deleted: false } });
}
